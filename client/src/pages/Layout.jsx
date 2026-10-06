import { useState, useEffect, useRef } from 'react'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import PendingInvitations from '../components/PendingInvitations'
import { Outlet } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { loadTheme } from '../features/themeSlice'
import { Loader2Icon } from 'lucide-react'
import { useUser, SignIn, useAuth, CreateOrganization, useOrganizationList } from '@clerk/clerk-react';
import { fetchWorkspaces } from '../features/workspaceSlice'

const Layout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const [showCreateOrg, setShowCreateOrg] = useState(false)

    // After the initial fetch returns empty, we do ONE retry (handles invitation race condition).
    // Only after the retry is done do we allow CreateOrganization to show.
    const [retryDone, setRetryDone] = useState(false)

    const { workspaces, hasFetched } = useSelector((state) => state.workspace)
    const dispatch = useDispatch()
    const { user, isLoaded } = useUser();
    const { getToken } = useAuth();
    const { userMemberships, userInvitations, isLoaded: isOrgListLoaded } = useOrganizationList({
        userMemberships: true,
        userInvitations: true
    });

    const isFetchingRef = useRef(false);

    // Initial load of theme
    useEffect(() => {
        dispatch(loadTheme())
    }, [dispatch])

    // Load workspaces whenever user is loaded or organization memberships change
    useEffect(() => {
        if (isLoaded && user?.id && !isFetchingRef.current) {
            isFetchingRef.current = true;
            dispatch(fetchWorkspaces({ getToken, sync: true })).finally(() => {
                isFetchingRef.current = false;
            });
        }
    }, [isLoaded, user?.id, userMemberships?.data?.length, dispatch]);

    // Retry effect — runs once after the first fetch completes and returns empty.
    // Handles the race condition where Clerk has accepted the invitation (server-side)
    // but the client SDK / Clerk API hasn't propagated the membership yet.
    useEffect(() => {
        if (!hasFetched || workspaces.length > 0 || isFetchingRef.current || retryDone) return;

        // Wait a moment for Clerk to propagate, then sync once more
        const timer = setTimeout(async () => {
            isFetchingRef.current = true;
            try {
                await dispatch(fetchWorkspaces({ getToken, sync: true })).unwrap();
            } catch (_) {
                // ignore
            } finally {
                isFetchingRef.current = false;
                setRetryDone(true);
            }
        }, 2000);

        return () => clearTimeout(timer);
    }, [hasFetched, workspaces.length]);

    // ── Render guards ────────────────────────────────────────────────────────

    // Wait for Clerk user session
    if (!isLoaded) {
        return (
            <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                <Loader2Icon className="size-7 text-blue-500 animate-spin" />
            </div>
        )
    }

    if (!user) {
        return (
            <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                <SignIn />
            </div>
        )
    }

    // Initial workspace fetch not done yet
    if (!hasFetched) {
        return (
            <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                <Loader2Icon className="size-7 text-blue-500 animate-spin" />
            </div>
        )
    }

    // Workspaces empty — wait for org list AND the retry before deciding anything
    if (workspaces.length === 0) {
        // Still loading org list or retry not done → show spinner (don't flash wrong UI)
        if (!isOrgListLoaded || !retryDone) {
            return (
                <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                    <Loader2Icon className="size-7 text-blue-500 animate-spin" />
                </div>
            )
        }

        // Org list loaded + retry done, user has pending invitations → show accept card
        if (userInvitations?.data?.length > 0 && !showCreateOrg) {
            return (
                <div className='flex items-center justify-center min-h-screen bg-slate-50 dark:bg-zinc-950 p-6'>
                    <div className='max-w-md w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm'>
                        <PendingInvitations standalone={true} onCreateOrgClick={() => setShowCreateOrg(true)} />
                    </div>
                </div>
            );
        }

        // User has org memberships but workspaces still haven't synced → spinner + retry
        if (userMemberships?.data?.length > 0) {
            return (
                <div className='flex flex-col items-center justify-center h-screen bg-white dark:bg-zinc-950 gap-4 text-center p-4'>
                    <Loader2Icon className="size-7 text-blue-500 animate-spin" />
                    <p className='text-zinc-700 dark:text-zinc-300 font-medium'>Syncing workspaces...</p>
                    <button
                        onClick={() => {
                            setRetryDone(false); // allow the retry effect to run again
                        }}
                        className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm transition'
                    >
                        Retry
                    </button>
                </div>
            )
        }

        // Truly no org memberships and no invitations → create org
        return (
            <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                <CreateOrganization
                    skipInvitationScreen
                    afterCreateOrganizationUrl="/"
                />
            </div>
        )
    }

    return (
        <div className="flex bg-white dark:bg-zinc-950 text-gray-900 dark:text-slate-100">
            <Sidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
            <div className="flex-1 flex flex-col h-screen">
                <Navbar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
                <div className="flex-1 h-full p-6 xl:p-10 xl:px-16 overflow-y-scroll">
                    <PendingInvitations />
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

export default Layout
