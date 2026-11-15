"use client";

export type PlaybackSpeed = "1" | "4" | "instant";

export function DevToolbar({ speed, onSpeed, onExport, onLoad, onPlay, onSnapshot }: {
  speed: PlaybackSpeed;
  onSpeed: (speed: PlaybackSpeed) => void;
  onExport: () => void;
  onLoad: (file: File) => void;
  onPlay: () => void;
  /** P2.7: opens the marked snapshot of the latest work in a new tab. */
  onSnapshot?: () => void;
}) {
  return (
    <div role="group" aria-label="Recording tools" className="work-toolbar work-toolbar--dev">
      <button type="button" onClick={onExport}>Export</button>
      <label>Load <input aria-label="Load recording" type="file" accept=".json,application/json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onLoad(file);
        }} /></label>
      <label>Playback speed <select value={speed} onChange={(event) => onSpeed(event.target.value as PlaybackSpeed)}>
        <option value="1">1x</option><option value="4">4x</option><option value="instant">instant</option>
      </select></label>
      <button type="button" onClick={onPlay}>Play</button>
      {onSnapshot && <button type="button" onClick={onSnapshot}>Snapshot</button>}
    </div>
  );
}
