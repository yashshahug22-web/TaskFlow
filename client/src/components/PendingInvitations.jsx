import { useState } from "react";
import { useOrganizationList, useAuth } from "@clerk/clerk-react";
import { useDispatch } from "react-redux";
import { fetchWorkspaces } from "../features/workspaceSlice";
import { Mail, Check, Loader2Icon, Building2 } from "lucide-react";
import toast from "react-hot-toast";

const PendingInvitations = ({ standalone = false, onCreateOrgClick }) => {
    const { userInvitations, userMemberships, isLoaded, setActive } = useOrganizationList({
        userInvitations: true,
        userMemberships: true
    });
    const { getToken } = useAuth();
    const dispatch = useDispatch();
    const [acceptingId, setAcceptingId] = useState(null);

    if (!isLoaded) return null;

    const invitations = userInvitations?.data || [];
    if (invitations.length === 0) {
        if (!standalone) return null;
        return (
            <div className="text-center py-6">
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">No pending invitations found.</p>
                {onCreateOrgClick && (
                    <button
                        onClick={onCreateOrgClick}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
                    >
                        Create an Organization
                    </button>
                )}
            </div>
        );
    }

    const handleAccept = async (invitation) => {
        setAcceptingId(invitation.id);
        try {
            await invitation.accept();
            if (userMemberships?.revalidate) {
                await userMemberships.revalidate();
            }
            await dispatch(fetchWorkspaces({ getToken, sync: true })).unwrap();

            if (setActive && invitation.publicOrganizationData?.id) {
                try {
                    await setActive({ organization: invitation.publicOrganizationData.id });
                } catch (setActiveErr) {
                    console.log("Notice on setActive:", setActiveErr);
                }
            }

            toast.success(`Joined ${invitation.publicOrganizationData?.name || "workspace"} successfully!`);
        } catch (error) {
            console.error("Error accepting invitation:", error);
            const msg = error?.errors?.[0]?.message || error.message || "Failed to accept invitation";
            toast.error(msg);
        } finally {
            setAcceptingId(null);
        }
    };

    if (standalone) {
        return (
            <div className="space-y-6">
                <div className="text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                        <Mail className="size-6" />
                    </div>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Workspace Invitations</h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                        You have been invited to collaborate on TaskFlow.
                    </p>
                </div>

                <div className="space-y-3">
                    {invitations.map((inv) => {
                        const orgName = inv.publicOrganizationData?.name || "Workspace";
                        const roleName = inv.role === "org:admin" ? "Admin" : "Member";
                        const isProcessing = acceptingId === inv.id;

                        return (
                            <div
                                key={inv.id}
                                className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-blue-600/10 text-blue-600 flex items-center justify-center font-bold">
                                        <Building2 className="size-5" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                                            {orgName}
                                        </h3>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            Role: <span className="font-medium text-blue-600 dark:text-blue-400">{roleName}</span>
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleAccept(inv)}
                                    disabled={isProcessing}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2Icon className="size-4 animate-spin" /> Accepting...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="size-4" /> Accept & Join
                                        </>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {onCreateOrgClick && (
                    <div className="pt-2 text-center border-t border-zinc-200 dark:border-zinc-800">
                        <button
                            onClick={onCreateOrgClick}
                            className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
                        >
                            Or create a new organization instead
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // In-app banner view for users who already have a workspace open
    return (
        <div className="space-y-3 mb-6">
            {invitations.map((inv) => {
                const orgName = inv.publicOrganizationData?.name || "Workspace";
                const roleName = inv.role === "org:admin" ? "Admin" : "Member";
                const isProcessing = acceptingId === inv.id;

                return (
                    <div
                        key={inv.id}
                        className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                                <Mail className="size-4" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                    You are invited to join <span className="font-semibold text-blue-600 dark:text-blue-400">{orgName}</span>
                                </p>
                                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                    Role: <span className="capitalize">{roleName}</span>
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => handleAccept(inv)}
                            disabled={isProcessing}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 self-start sm:self-auto disabled:opacity-50"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2Icon className="size-3.5 animate-spin" /> Accepting...
                                </>
                            ) : (
                                <>
                                    <Check className="size-3.5" /> Accept Invitation
                                </>
                            )}
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

export default PendingInvitations;
