import React, { useState } from 'react';
import { FolderKanban, Plus, Trash2, Sparkles, AlertCircle, ArrowRight, Check } from 'lucide-react';
import { api } from '../services/api.ts';
import type { Project } from '../types/index.ts';

interface ProjectsPageProps {
  projects: Project[];
  onRefresh: () => void;
  onSelectProject: (projectId: string) => void;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({
  projects,
  onRefresh,
  onSelectProject,
}) => {
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [seedSuccess, setSeedSuccess] = useState<string | null>(null);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await api.createProject({ name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
      setIsCreating(false);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleSeedExample = async () => {
    if (!confirm('Create official "Smart Irrigation" example with ESP32 Greenhouse 01 device and datastreams (V0-V3)? Note: No fake sensor data is created.')) {
      return;
    }

    setLoading(true);
    setSeedSuccess(null);
    try {
      const res = await api.seedExampleProject();
      setSeedSuccess(`Created "${res.project.name}" with token: ${res.deviceToken}`);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to seed example project');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, projectName: string) => {
    if (!confirm(`Are you sure you want to delete project "${projectName}"? All devices and datastreams in it will be deleted.`)) {
      return;
    }
    try {
      await api.deleteProject(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to delete project');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-sky-400" />
            Projects
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Organize IoT devices and datastreams by application or physical location
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="seed-example-btn"
            onClick={handleSeedExample}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span>Seed Smart Irrigation Example</span>
          </button>

          <button
            id="create-project-modal-btn"
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky-500/20 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Seed Success Notification */}
      {seedSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3 text-emerald-300 text-xs">
          <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="overflow-hidden">
            <strong className="font-semibold block text-emerald-200">Smart Irrigation Example Ready!</strong>
            <p className="font-mono text-[11px] text-emerald-400 break-all select-all mt-0.5">
              {seedSuccess}
            </p>
          </div>
        </div>
      )}

      {/* Create Project Card Form */}
      {isCreating && (
        <form
          onSubmit={handleCreateProject}
          className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-lg space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">Create New Project</h3>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Project Name *
              </label>
              <input
                id="new-project-name"
                type="text"
                required
                placeholder="e.g. Smart Irrigation, Solar Plant, Lab Monitor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Description (Optional)
              </label>
              <input
                id="new-project-desc"
                type="text"
                placeholder="Brief purpose or location description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              id="save-project-btn"
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs"
            >
              {loading ? 'Creating...' : 'Save Project'}
            </button>
          </div>
        </form>
      )}

      {/* Projects List */}
      {projects.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <FolderKanban className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <h3 className="text-base font-bold text-white">No Projects Found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
            Click "Seed Smart Irrigation Example" to instantly explore the reference setup, or create your own project.
          </p>
          <button
            onClick={handleSeedExample}
            className="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-semibold text-xs inline-flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Seed Smart Irrigation Example
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              id={`project-card-${p.id}`}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <h3 className="text-base font-bold text-white">{p.name}</h3>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Delete project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1 min-h-[32px] line-clamp-2">
                  {p.description || 'No description provided.'}
                </p>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  Created {new Date(p.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => onSelectProject(p.id)}
                  className="flex items-center gap-1 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                >
                  <span>View Devices</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
