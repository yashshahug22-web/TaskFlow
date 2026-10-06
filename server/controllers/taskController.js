import { inngest } from "../inngest/index.js";
import { prisma } from "../config/prisma.js";


//create task 
export const createTask = async (req, res) => {
    try {
        const { userId } = await req.auth() //logged in users ID 
        const { projectId, title, description, type, status, priority, assigneeId, due_date } = req.body
        const origin = req.get('origin');

        //check if user has admin role for project
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                members: { include: { user: true } },
                workspace: { include: { members: { include: { user: true } } } }
            }
        })
        if (!project) {
            return res.status(404).json({ message: 'Project not found' })
        } else if (project.team_lead !== userId) {
            return res.status(403).json({ message: 'You do not have permission to update tasks for this project' })
        } else if (assigneeId && !project.workspace.members.find((member) => member.user.id === assigneeId)) {
            return res.status(400).json({ message: 'Assignee is not a member of the workspace' })
        }

        const task = await prisma.task.create({
            data: {
                projectId,
                title,
                description,
                type,
                status,
                priority,
                type,
                assigneeId,
                due_date: new Date(due_date),
            }
        });

        const taskWithAssignee = await prisma.task.findUnique({
            where: { id: task.id },
            include: { assignee: true }
        });

        await inngest.send({
            name: "app/task.assigned",
            data: {
                taskId: task.id,
                origin
            }
        })

        res.json({ task: taskWithAssignee, message: 'Task created successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.code || error.message });
    }
}

//update task
export const updateTask = async (req, res) => {
    try {
        const task = await prisma.task.findUnique({
            where: { id: req.params.id }
        });
        if (!task) {
            return res.status(404).json({ message: 'Task not found' })
        }
        const { userId } = await req.auth()

        const project = await prisma.project.findUnique({
            where: { id: task.projectId },
            include: {
                workspace: { include: { members: true } }
            }
        })
        if (!project) {
            return res.status(404).json({ message: 'Project not found' })
        }

        const isTeamLead = project.team_lead === userId;
        const isAssignee = task.assigneeId === userId;
        const isWorkspaceAdmin = project.workspace.ownerId === userId ||
            project.workspace.members.some(m => m.userId === userId && m.role === 'ADMIN');

        if (!isTeamLead && !isAssignee && !isWorkspaceAdmin) {
            return res.status(403).json({ message: 'You do not have permission to update this task' })
        }

        // Assignees (who are not admins/team lead) can only change the status
        let updateData = req.body;
        if (isAssignee && !isTeamLead && !isWorkspaceAdmin) {
            updateData = { status: req.body.status };
        }

        const updatedTask = await prisma.task.update({
            where: { id: req.params.id },
            data: updateData,
            include: { assignee: true }
        });

        res.json({ task: updatedTask, message: 'Task updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.code || error.message });
    }
}

//delete task
export const deleteTask = async (req, res) => {
    try {
        const { userId } = await req.auth()
        const { taskIds } = req.body
        const tasks = await prisma.task.findMany({
            where: { id: { in: taskIds } }
        })
        if (tasks.length === 0) {
            return res.status(404).json({ message: 'No tasks found to delete' })
        }

        const project = await prisma.project.findUnique({
            where: { id: tasks[0].projectId },
            include: {
                workspace: { include: { members: true } }
            }
        })
        if (!project) {
            return res.status(404).json({ message: 'Project not found' })
        }

        const isTeamLead = project.team_lead === userId;
        const isWorkspaceAdmin = project.workspace.ownerId === userId ||
            project.workspace.members.some(m => m.userId === userId && m.role === 'ADMIN');

        if (!isTeamLead && !isWorkspaceAdmin) {
            return res.status(403).json({ message: 'Only admins can delete tasks' })
        }

        await prisma.task.deleteMany({
            where: { id: { in: taskIds } }
        });

        res.json({ message: 'Task deleted successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.code || error.message });
    }
}