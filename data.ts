
import { Folder, Document, Project, Task, User } from './types';

export const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Alex Chen', email: 'alex@acme.com', role: 'SuperAdmin', avatar: 'https://i.pravatar.cc/150?u=u1' },
  { id: 'u2', name: 'Sarah Jones', email: 'sarah@acme.com', role: 'TeamManager', avatar: 'https://i.pravatar.cc/150?u=u2' },
  { id: 'u3', name: 'Mike Ross', email: 'mike@acme.com', role: 'Contributor', avatar: 'https://i.pravatar.cc/150?u=u3' },
  { id: 'u4', name: 'Jessica Lee', email: 'jess@globex.com', role: 'Contributor', avatar: 'https://i.pravatar.cc/150?u=u4' },
];

export const MOCK_PROJECTS: Project[] = [
  { id: 'p1', name: 'Q1 Infrastructure Revamp', color: '#6366f1', teamId: 't1' },
  { id: 'p2', name: 'Mobile App Redesign', color: '#ec4899', teamId: 't1' },
  { id: 'p3', name: 'HR System Integration', color: '#10b981', teamId: 't2' },
];

export const MOCK_TASKS: Task[] = [
  { id: 'tk1', projectId: 'p1', title: 'Migrate DB to RDS', description: 'Move the primary PostgreSQL instance to AWS Managed RDS.', priority: 'High', status: 'In Progress', assigneeIds: ['u1', 'u2'] },
  { id: 'tk2', projectId: 'p1', title: 'Update Dockerfiles', description: 'Standardize node images to Alpine 20.', priority: 'Medium', status: 'Todo', assigneeIds: ['u3'], imageUrl: 'https://picsum.photos/seed/docker/400/200' },
  { id: 'tk3', projectId: 'p2', title: 'UX Audit', description: 'Conduct a full audit of the current navigation flow.', priority: 'High', status: 'Todo', assigneeIds: ['u2'] },
  { id: 'tk4', projectId: 'p1', title: 'Documentation', description: 'Write API documentation for the new auth layer.', priority: 'Low', status: 'Completed', assigneeIds: ['u3', 'u4'] },
  { id: 'tk5', projectId: 'p2', title: 'Home Screen Wireframes', description: 'Create low-fi wireframes for the dashboard.', priority: 'Medium', status: 'In Progress', assigneeIds: ['u2', 'u1'], imageUrl: 'https://picsum.photos/seed/ux/400/200' },
];

export const MOCK_FOLDERS: Folder[] = [
  { id: 'f1', name: 'Engineering', sharedWithTeamIds: ['t1'], parentId: undefined },
  { id: 'f2', name: 'HR Policies', sharedWithTeamIds: ['all'], parentId: undefined },
  { id: 'f3', name: 'Sales Data', sharedWithTeamIds: ['t2'], parentId: undefined },
  { id: 'f1-1', name: 'Backend', sharedWithTeamIds: ['t1'], parentId: 'f1' }, 
  { id: 'f1-2', name: 'Frontend', sharedWithTeamIds: ['t1'], parentId: 'f1' }, 
];

export const MOCK_DOCS: Document[] = [
  { id: '1', name: 'Engineering_Handbook_v2.pdf', type: 'PDF', tags: ['Onboarding', 'Core'], uploadDate: '2023-10-01', contentSnippet: "Core values: Ship fast, break nothing.", folderId: 'f1' },
  { id: '2', name: 'Q3_Sales_Report.csv', type: 'CSV', tags: ['Sales', 'Data'], uploadDate: '2023-10-15', contentSnippet: "Q3 Total: $1.2M. Growth: 15%.", folderId: 'f3' },
  { id: '3', name: 'Travel_Reimbursement_Policy.docx', type: 'DOCX', tags: ['HR', 'Policy'], uploadDate: '2023-09-20', contentSnippet: "Meals allowance: $50/day. Receipts required.", folderId: 'f2' },
  { id: '4', name: 'General_Company_Info.txt', type: 'TXT', tags: ['General'], uploadDate: '2023-01-01', contentSnippet: "Founded in 2020. HQ in San Francisco.", folderId: undefined }, 
  { id: '5', name: 'API_Specs.md', type: 'TXT', tags: ['Tech'], uploadDate: '2023-11-01', contentSnippet: "GET /api/users returns list of users.", folderId: 'f1-1' },
];
