const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  bag: "M5 8h14l1 13H4L5 8Zm4 2V6a3 3 0 0 1 6 0v4",
  cake: "M3 20h18M5 20v-8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8M5 14c2 0 2 2 4 2s2-2 3-2 2 2 4 2 2-2 3-2M9 10V7m6 3V7M9 4v.01M15 4v.01",
  calendar: "M8 3v4m8-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  chart: "M4 19h16M7 15v-4m5 4V5m5 10V8",
  check: "m5 12 4 4L19 6",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  up: "M12 19V5m-6 6 6-6 6 6",
  down: "M12 5v14m-6-6 6 6 6-6",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  eye: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  eyeOff: "m3 3 18 18M10.6 6.1A9 9 0 0 1 12 6c6 0 10 6 10 6a16 16 0 0 1-3.1 3.5M6.3 7.8A17 17 0 0 0 2 12s4 6 10 6c1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  grid: "M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z",
  inbox: "M4 4h16v16H4zM4 13h5l1 2h4l1-2h5",
  list: "M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01",
  lock: "M6 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V8a4 4 0 0 1 8 0v2m-4 4v2",
  edit: "m14 5 5 5M4 20l1-5L16 4a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L9 19l-5 1Z",
  search: "M16 16l4 4M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  spark: "M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z",
  user: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
