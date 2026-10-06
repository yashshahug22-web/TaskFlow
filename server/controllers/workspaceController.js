import { prisma } from "../config/prisma.js";
import { clerkClient } from "@clerk/express";

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
        if (memberships?.data) {
            for (const m of memberships.data) {
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
            }
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

        // Auto-sync user and organizations from Clerk to ensure DB is up to date
        await syncUserAndWorkspacesFromClerk(userId);

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
        res.status(500).json({ message: error.code || error.message })
    }
}