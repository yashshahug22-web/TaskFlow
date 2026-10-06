
//add comment
import { prisma } from "../config/prisma.js";

export const addComment = async (req, res) => {
    try {
        const { userId } = await req.auth()   // ← was missing await
        const { taskId, content } = req.body

        if (!content?.trim()) {
            return res.status(400).json({ message: 'Comment cannot be empty' })
        }

        // Check user is a workspace member (not just project member)
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: {
                project: {
                    include: {
                        workspace: { include: { members: true } }
                    }
                }
            }
        });

        if (!task) {
            return res.status(404).json({ message: 'Task not found' })
        }

        const workspace = task.project.workspace;
        const isWorkspaceMember =
            workspace.ownerId === userId ||
            workspace.members.some(m => m.userId === userId);

        if (!isWorkspaceMember) {
            return res.status(403).json({ message: 'You do not have permission to comment on this task' })
        }

        // Create comment and return it with user data so the client can render immediately
        const comment = await prisma.comment.create({
            data: { taskId, userId, content: content.trim() },
            include: { user: true }
        });

        res.json({ comment, message: 'Comment added successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.code || error.message });
    }
}

//get task comments
export const getComments = async (req, res) => {
    try {
        const {taskId} = req.params
        const comments = await prisma.comment.findMany({
            where: {taskId},
            include: {user: true},
            orderBy: {createdAt: 'desc'}
        });
        res.json({comments});
    } catch (error) {
        console.error(error);
        res.status(500).json({message:error.code || error.message});
    }
}