import { useState, useEffect, useRef } from 'react'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import { Outlet } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { loadTheme } from '../features/themeSlice'
import { Loader2Icon } from 'lucide-react'
import { useUser, SignIn, useAuth, CreateOrganization, useOrganizationList } from '@clerk/clerk-react';
import { fetchWorkspaces } from '../features/workspaceSlice'

const Layout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const { loading, workspaces, hasFetched } = useSelector((state) => state.workspace)
    const dispatch = useDispatch()
    const { user, isLoaded } = useUser();
    const { getToken } = useAuth();
    const { userMemberships, isLoaded: isOrgListLoaded } = useOrganizationList({
        userMemberships: true
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
            dispatch(fetchWorkspaces({ getToken })).finally(() => {
                isFetchingRef.current = false;
            });
        }
    }, [isLoaded, user?.id, userMemberships?.data?.length, dispatch]);

    if (!isLoaded || !isOrgListLoaded) {
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

    // Only show full-screen loader on initial boot
    if (!hasFetched) {
        return (
            <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                <Loader2Icon className="size-7 text-blue-500 animate-spin" />
            </div>
        )
    }

    // Only prompt to create organization if the user truly has NO organizations in Clerk and NO workspaces
    if (user && isOrgListLoaded && userMemberships?.data?.length === 0 && workspaces.length === 0) {
        return (
            <div className='flex items-center justify-center h-screen bg-white dark:bg-zinc-950'>
                <CreateOrganization
                    skipInvitationScreen
                    afterCreateOrganizationUrl="/"
                />
            </div>
        )
    }

    // If workspaces failed to load despite user having organizations
    if (user && workspaces.length === 0) {
        return (
            <div className='flex flex-col items-center justify-center h-screen bg-white dark:bg-zinc-950 gap-4 text-center p-4'>
                <p className='text-zinc-700 dark:text-zinc-300 font-medium'>Syncing workspaces...</p>
                <button
                    onClick={() => dispatch(fetchWorkspaces({ getToken }))}
                    className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm transition'
                >
                    Retry
                </button>
            </div>
        )
    }

    return (
        <div className="flex bg-white dark:bg-zinc-950 text-gray-900 dark:text-slate-100">
            <Sidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
            <div className="flex-1 flex flex-col h-screen">
                <Navbar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
                <div className="flex-1 h-full p-6 xl:p-10 xl:px-16 overflow-y-scroll">
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

export default Layout
