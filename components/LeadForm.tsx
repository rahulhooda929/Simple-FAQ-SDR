import React from 'react';
import { LeadData } from '../types';

interface LeadFormProps {
  data: LeadData;
}

const Field = ({ label, value }: { label: string; value?: string }) => (
  <div className="flex flex-col mb-3">
    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
    <div className={`text-sm font-medium ${value ? 'text-slate-800' : 'text-slate-300 italic'}`}>
      {value || 'Not collected yet...'}
    </div>
  </div>
);

export const LeadForm: React.FC<LeadFormProps> = ({ data }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Live CRM Data
        </h2>
        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full animate-pulse">
          LIVE
        </span>
      </div>

      <div className="space-y-1 custom-scrollbar overflow-y-auto flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Contact Name" value={data.name} />
          <Field label="Email Address" value={data.email} />
          <Field label="Company" value={data.company} />
          <Field label="Role" value={data.role} />
          <Field label="Team Size" value={data.teamSize} />
          <Field label="Timeline" value={data.timeline} />
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <Field label="Use Case / Notes" value={data.useCase} />
        </div>
        {data.summary && (
           <div className="mt-4 pt-4 border-t border-slate-100 bg-blue-50 p-4 rounded-lg">
             <Field label="Final Summary" value={data.summary} />
           </div>
        )}
      </div>
    </div>
  );
};