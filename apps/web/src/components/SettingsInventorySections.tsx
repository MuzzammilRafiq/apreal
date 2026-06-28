import {
  getToolKindLabel,
  getToolToneClassName,
  type SettingsSection,
} from "./settings-helpers";
import type { AvailableSkill, AvailableTool } from "@apreal/shared";

type SettingsInventorySectionsProps = {
  activeSection: SettingsSection;
  availableSkills: AvailableSkill[];
  availableTools: AvailableTool[];
};

export function SettingsInventorySections({
  activeSection,
  availableSkills,
  availableTools,
}: SettingsInventorySectionsProps) {
  return (
    <>
      {activeSection === "skills" && (
          <div className="p-2">
            {availableSkills.length === 0 ? (
              <p className="mt-4 border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
                No skills are currently available.
              </p>
            ) : (
              <div className="p-2 mt-3 grid gap-2 min-[980px]:grid-cols-2 ">
                {availableSkills.map((skill) => (
                  <article
                    key={`${skill.name}:${skill.location}`}
                    className="border border-slate-200 bg-white/70 px-3 py-3 rounded"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[0.92rem] font-bold text-slate-900">
                          {skill.name}
                        </h3>
                        <p className="mt-1.5 text-[0.79rem] leading-[1.45] text-slate-600">
                          {skill.description}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
      )}
      {activeSection === "tools" && (
          <div className="p-3">
            {availableTools.length === 0 ? (
              <p className="mt-4 border border-dashed border-slate-300 py-5 text-center text-sm font-semibold text-slate-500">
                No tools are currently enabled.
              </p>
            ) : (
              <div className="overflow-hidden ">
                {availableTools.map((tool, index) => (
                  <div
                    key={tool.name}
                    className={`grid gap-2 px-0 py-3 min-[760px]:grid-cols-[minmax(0,1fr)_auto] min-[760px]:items-start ${
                      index > 0 ? "border-t border-black/8" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-[0.94rem] font-bold text-slate-900">
                        {tool.label}
                      </p>
                      <p className="mt-1 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-400">
                        Tool name: {tool.name}
                      </p>
                      <p className="mt-1.5 text-[0.8rem] leading-[1.45] text-slate-600">
                        {tool.description}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 border px-2 py-0.5 font-mono text-[0.63rem] font-semibold uppercase tracking-widest ${getToolToneClassName(tool.kind)} rounded`}
                    >
                      {getToolKindLabel(tool.kind)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
      )}
    </>
  );
}
