import { prisma } from "../config/prisma.js";
import { clerkClient } from "@clerk/express";
import sendEmail from "../config/nodemailer.js";

// Sync user and their organizations from Clerk into Prisma DB
export const syncUserAndWorkspacesFromClerk = async (userId) => {
    try {
        if (!userId) return;
        const clerkUser = await clerkClient.users.getUser(userId);
        if (!clerkUser) return;

        const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
        const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email.split('@')[0] || 'User';
        const image = clerkUser.imageUrl || '';

        // Upsert current user in Prisma
        await prisma.user.upsert({
            where: { id: userId },
            update: { name, email, image },
            create: { id: userId, name, email, image }
        });

        // Fetch organization memberships from Clerk
        const memberships = await clerkClient.users.getOrganizationMembershipList({ userId });
        if (memberships?.data?.length > 0) {
            await Promise.all(
                memberships.data.map(async (m) => {
                    const org = m.organization;
                    const ownerId = org.createdBy || userId;

                    // Ensure owner exists in database if different from current user
                    if (ownerId !== userId) {
                        const ownerExists = await prisma.user.findUnique({ where: { id: ownerId } });
                        if (!ownerExists) {
                            try {
                                const clerkOwner = await clerkClient.users.getUser(ownerId);
                                const ownerEmail = clerkOwner.emailAddresses?.[0]?.emailAddress || '';
                                const ownerName = [clerkOwner.firstName, clerkOwner.lastName].filter(Boolean).join(' ') || 'User';
                                await prisma.user.upsert({
                                    where: { id: ownerId },
                                    update: { name: ownerName, email: ownerEmail, image: clerkOwner.imageUrl || '' },
                                    create: { id: ownerId, name: ownerName, email: ownerEmail, image: clerkOwner.imageUrl || '' }
                                });
                            } catch (err) {
                                console.error('Error syncing owner user from Clerk:', err);
                            }
                        }
                    }

                    // Upsert workspace
                    await prisma.workspace.upsert({
                        where: { id: org.id },
                        update: {
                            name: org.name,
                            slug: org.slug || org.id,
                            image_url: org.imageUrl || ''
                        },
                        create: {
                            id: org.id,
                            name: org.name,
                            slug: org.slug || org.id,
                            ownerId,
                            image_url: org.imageUrl || ''
                        }
                    });

                    // Upsert membership
                    const role = (m.role === 'org:admin' || m.role === 'ADMIN') ? 'ADMIN' : 'MEMBER';
                    await prisma.workspaceMember.upsert({
                        where: {
                            userId_workspaceId: {
                                userId,
                                workspaceId: org.id
                            }
                        },
                        update: { role },
                        create: {
                            userId,
                            workspaceId: org.id,
                            role
                        }
                    });
                })
            );
        }
    } catch (error) {
        console.error('Error syncing user and workspaces from Clerk:', error);
    }
};

// Get all workspaces for user
export const getUserWorkspaces = async (req, res) => {
    try {
        const { userId } = await req.auth(); // logged in user ID
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // Fast check: how many workspaces does the user have in DB?
        const existingCount = await prisma.workspaceMember.count({
            where: { userId }
        });

        // Only do the heavy Clerk API sync if user has 0 workspaces in DB or explicitly asked via ?sync=true
        if (existingCount === 0 || req.query.sync === 'true') {
            await syncUserAndWorkspacesFromClerk(userId);
        }

        const workspaces = await prisma.workspace.findMany({
            where: {
                members: { some: { userId: userId } }
            },
            include: {
                owner: true,
                members: { include: { user: true } },
                projects: {
                    include: {
                        tasks: { include: { assignee: true, comments: { include: { user: true } } } },
                        members: { include: { user: true } },
                        owner: true
                    }
                }
            }
        });
        res.json({ workspaces });
    } catch (error) {
        console.error('Error in getUserWorkspaces:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};

//Add member to workspace
export const addMember = async (req, res) => {
    try {
        const { userId } = await req.auth() //logged in users ID;
        const { email, role, workspaceId, message} = req.body;

        //check if user exists
        const user = await prisma.user.findUnique({ where: { email: email } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if(!workspaceId || !role){
            return res.status(400).json({ message: 'Workspace ID and role are required' });
        }
        if(!['ADMIN', 'MEMBER'].includes(role)){
            return res.status(400).json({ message: 'Invalid role' });
        }

        //fetch workspace 
        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, include: { members: true } });
        if (!workspace) {
            return res.status(404).json({ message: 'Workspace not found' });
        }

        //check creator has admin role
        if(!workspace.members.find(m => m.userId === userId && m.role === 'ADMIN')){
            return res.status(403).json({ message: 'Only admins can add members' });
        }

        //check if user is already a member
        const existingMember = workspace.members.find(m => m.userId === user.id);
        if (existingMember) {
            return res.status(400).json({ message: 'User is already a member of the workspace' });
        }

        const member = await prisma.workspaceMember.create({
            data: {
                userId: user.id,
                workspaceId,
                role,
                message
            }
        });
        res.json({ member, message: "Member added successfully" });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Invite member to workspace and send real email via nodemailer/Brevo
export const inviteMember = async (req, res) => {
    try {
        const { userId } = await req.auth(); // logged in user ID
        const { email, role = 'MEMBER', workspaceId } = req.body;

        console.log('[inviteMember] userId:', userId, '| email:', email, '| workspaceId:', workspaceId, '| role:', role);

        if (!email || !workspaceId) {
            return res.status(400).json({ message: 'Email and workspace ID are required' });
        }

        // Fetch workspace
        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: true } }, owner: true }
        });

        if (!workspace) {
            console.log('[inviteMember] Workspace not found:', workspaceId);
            return res.status(404).json({ message: 'Workspace not found' });
        }

        console.log('[inviteMember] Workspace found:', workspace.name, '| ownerId:', workspace.ownerId);
        console.log('[inviteMember] Members:', workspace.members.map(m => ({ userId: m.userId, role: m.role, email: m.user?.email })));

        // Check inviter has ADMIN role or is owner — check DB first, fall back to Clerk
        let isAdmin = workspace.members.some(m => m.userId === userId && m.role === 'ADMIN') || workspace.ownerId === userId;
        console.log('[inviteMember] isAdmin (DB):', isAdmin, '| userId === ownerId:', workspace.ownerId === userId);

        if (!isAdmin) {
            // DB might be stale — double-check via Clerk
            try {
                const clerkMembership = await clerkClient.organizations.getOrganizationMembership({
                    organizationId: workspaceId,
                    userId
                });
                isAdmin = clerkMembership?.role === 'org:admin';
                console.log('[inviteMember] isAdmin (Clerk fallback):', isAdmin, '| Clerk role:', clerkMembership?.role);
            } catch (clerkCheckErr) {
                console.log('[inviteMember] Could not verify admin via Clerk:', clerkCheckErr?.message);
            }
        }

        if (!isAdmin) {
            return res.status(403).json({ message: 'Only admins can invite members' });
        }

        // Check if user is already a member
        const alreadyMember = workspace.members.some(m => m.user?.email?.toLowerCase() === email.toLowerCase());
        console.log('[inviteMember] alreadyMember:', alreadyMember);
        if (alreadyMember) {
            return res.status(400).json({ message: 'User is already a member of this workspace' });
        }

        // Fetch inviter info
        const inviter = await prisma.user.findUnique({ where: { id: userId } });
        const inviterName = inviter?.name || 'A team member';
        console.log('[inviteMember] inviterName:', inviterName);

        // Create Clerk invitation and get the one-time acceptance URL
        const clerkRole = (role === 'ADMIN' || role === 'org:admin') ? 'org:admin' : 'org:member';
        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

        // Revoke ALL pending invitations for the entire org before creating a new one.
        // Clerk counts every pending invite against the org membership quota — stale invites
        // from previous calls (any email) pile up and exhaust the limit if not cleaned up.
        try {
            const existing = await clerkClient.organizations.getOrganizationInvitationList({
                organizationId: workspaceId,
                status: 'pending',
                limit: 500
            });
            if (existing.data.length > 0) {
                console.log(`[inviteMember] Revoking ${existing.data.length} stale org-wide pending invite(s)`);
                // Use workspace ownerId as requestingUserId — guaranteed to be an org admin
                const requestingUserId = workspace.ownerId;
                await Promise.all(
                    existing.data.map(inv =>
                        clerkClient.organizations.revokeOrganizationInvitation({
                            organizationId: workspaceId,
                            invitationId: inv.id,
                            requestingUserId
                        }).catch(e => console.log('[inviteMember] Revoke warning:', e?.message))
                    )
                );
            }
        } catch (listErr) {
            console.log('[inviteMember] Could not list pending invites (non-fatal):', listErr?.message);
        }

        // Now create a fresh invitation
        let inviteUrl = '';
        try {
            const inv = await clerkClient.organizations.createOrganizationInvitation({
                organizationId: workspaceId,
                emailAddress: email,
                role: clerkRole,
                inviterUserId: userId,
                redirectUrl: clientUrl
            });
            inviteUrl = inv?.url || inv?._raw?.url || '';
            console.log('[inviteMember] Invite created, URL obtained:', !!inviteUrl);
        } catch (clerkErr) {
            const clerkMsg = clerkErr?.errors?.[0]?.message || clerkErr?.message || 'Unknown error';
            console.error('[inviteMember] Clerk invite creation failed:', clerkMsg, clerkErr?.errors);
            return res.status(500).json({ message: `Could not create invitation: ${clerkMsg}` });
        }

        if (!inviteUrl) {
            return res.status(500).json({ message: 'Could not retrieve invitation link. Please try again.' });
        }

        const joinLink = inviteUrl;


        // Send styled invitation email via Brevo SMTP
        const emailHtml = `
        <div style="max-width: 600px; margin: 30px auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <div style="margin-bottom: 28px;">
                <span style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 700; font-size: 18px; padding: 6px 14px; border-radius: 6px; letter-spacing: -0.5px;">TaskFlow</span>
            </div>
            <h2 style="color: #111827; font-size: 22px; margin: 0 0 16px; font-weight: 700; line-height: 1.3;">
                You've been invited to join ${workspace.name}
            </h2>
            <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 28px;">
                <strong>${inviterName}</strong> has invited you to collaborate on the <strong>${workspace.name}</strong> workspace as a <strong>${clerkRole === 'org:admin' ? 'Admin' : 'Member'}</strong>.
            </p>
            <div style="margin: 32px 0;">
                <a href="${joinLink}" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; font-weight: 600; font-size: 15px; text-decoration: none; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);">
                    Accept Invitation & Join Team
                </a>
            </div>
            <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f3f4f6; color: #6b7280; font-size: 13px; line-height: 1.6;">
                <p style="margin: 0 0 8px;">
                    Click the button above to accept this invitation and get started right away.
                </p>
                <p style="margin: 0;">
                    You can also open <a href="${clientUrl}" style="color: #2563eb; text-decoration: underline; font-weight: 500;">TaskFlow</a> directly and sign in with this email (<strong>${email}</strong>) to accept pending invitations anytime.
                </p>
            </div>
        </div>
        `;

        await sendEmail({
            to: email,
            subject: `${inviterName} invited you to join ${workspace.name} on TaskFlow`,
            body: emailHtml
        });

        res.json({ message: 'Invitation email sent successfully!', inviteUrl: joinLink });
    } catch (error) {
        console.error('Error in inviteMember:', error);
        res.status(500).json({ message: error.code || error.message });
    }
};