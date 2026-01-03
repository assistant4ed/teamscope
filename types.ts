export enum AppModule {
  PULSE = 'Pulse',
  BRAIN = 'Brain',
  ACADEMY = 'Academy',
  PROJECTS = 'Projects',
  ADMIN = 'Admin',
  SETTINGS = 'Settings'
}

export type UserRole = 'SuperAdmin' | 'OrgManager' | 'TeamManager' | 'Contributor';
export type TaskPriority = 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Todo' | 'In Progress' | 'Completed';

export interface AccessControl {
  orgIds: string[];
  teamIds: string[];
  userIds: string[];
  isPublic?: boolean;
}

export interface Organization {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  organizationId: string;
  name: string;
  managerId?: string;
}

export interface Team {
  id: string;
  departmentId: string;
  name: string;
  managerId?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  departmentId?: string;
  teamId?: string;
  avatar: string;
}

export interface LogEntry {
    tasks: string;
    blockers: string;
    energyLevel?: number;
    workDurationMinutes?: number;
    timestamp: number;
    status: 'draft' | 'submitted';
}

export interface DailyLog {
  id: string;
  userId: string;
  userName: string;
  date: string;
  checkIn?: LogEntry;
  checkOut?: LogEntry;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  teamId: string;
  deadline?: string;
  access?: AccessControl;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeIds: string[];
  imageUrl?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string; 
  organizationId?: string; 
  access?: AccessControl;
  sharedWithTeamIds: string[];
}

export interface Document {
  id: string;
  name: string;
  type: 'PDF' | 'DOCX' | 'TXT' | 'CSV';
  tags: string[];
  uploadDate: string;
  contentSnippet: string; 
  folderId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isThinking?: boolean;
}

export interface ModuleResource {
  id: string;
  title: string;
  type: 'file' | 'link' | 'brain_doc' | 'brain_folder';
  url?: string;
  brainId?: string;
}

export interface LearningModule {
  id: string;
  title: string;
  status: 'locked' | 'active' | 'completed';
  description: string;
  content: string;
  resources: ModuleResource[];
  access?: AccessControl;
}