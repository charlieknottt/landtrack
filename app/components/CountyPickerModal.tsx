"use client";

import { useMemo, useState } from "react";
import { countyKey } from "@/lib/constants";

const STATE_NAMES: Record<string, string> = {
  PA: "Pennsylvania",
  AL: "Alabama",
};

interface CountyInfo {
  state: string;
  name: string;
  count: number;
}

interface Props {
  counties: CountyInfo[];
  initialSelected: string[];
  firstTime: boolean;
  saving: boolean;
  onSave: (keys: string[]) => void;
  onClose: () => void;
}

export default function CountyPickerModal({ counties, initialSelected, firstTime, saving, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));

  const byState = useMemo(() => {
    const groups = new Map<string, CountyInfo[]>();
    for (const c of counties) {
      const list = groups.get(c.state) || [];
      list.push(c);
      groups.set(c.state, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [counties]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleState = (state: string, stateCounties: CountyInfo[]) => {
    const keys = stateCounties.map((c) => countyKey(state, c.name));
    const allOn = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40" onClick={firstTime ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[440px] max-h-[80vh] flex flex-col p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-[#0a0a0a]">
            {firstTime ? "Welcome! Choose your counties" : "Choose Counties"}
          </h2>
          {!firstTime && (
            <button onClick={onClose} className="text-[#a1a1aa] hover:text-[#0a0a0a] text-xl leading-none">&times;</button>
          )}
        </div>
        <p className="text-xs text-[#71717a] mb-4">
          The map only loads parcels from the counties you pick, so choosing fewer keeps it fast.
          You can change this anytime from the &quot;Counties&quot; button in the header.
        </p>

        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {byState.map(([state, stateCounties]) => {
            const keys = stateCounties.map((c) => countyKey(state, c.name));
            const allOn = keys.every((k) => selected.has(k));
            return (
              <div key={state}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#52525b]">
                    {STATE_NAMES[state] || state}
                  </span>
                  <button
                    onClick={() => toggleState(state, stateCounties)}
                    className="text-[10px] text-[#71717a] hover:text-[#e97316] transition-colors"
                  >
                    {allOn ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {stateCounties.map((c) => {
                    const key = countyKey(state, c.name);
                    const on = selected.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                          on ? "border-[#e97316] bg-[#fff7ed]" : "border-[#e4e4e7] hover:bg-[#fafafa]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(key)}
                          className="w-3.5 h-3.5 accent-[#e97316] rounded"
                        />
                        <span className="text-xs text-[#0a0a0a] truncate">{c.name}</span>
                        <span className="text-[10px] text-[#a1a1aa] ml-auto">{c.count.toLocaleString()}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => onSave([...selected])}
          disabled={saving || selected.size === 0}
          className="w-full py-2 bg-[#e97316] text-white text-sm font-medium rounded-lg hover:bg-[#c2410c] transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : selected.size === 0 ? "Pick at least one county" : `Show ${selected.size} ${selected.size === 1 ? "county" : "counties"}`}
        </button>
      </div>
    </div>
  );
}
