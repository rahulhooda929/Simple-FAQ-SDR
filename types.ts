export interface LeadData {
  name?: string;
  company?: string;
  email?: string;
  role?: string;
  useCase?: string;
  teamSize?: string;
  timeline?: string;
  summary?: string;
}

export interface LogMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: Date;
}

export enum ConnectionState {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
  ERROR,
}