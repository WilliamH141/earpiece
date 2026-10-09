type State = "on" | "off" | "error";

export function listen(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  onState: (s: State, msg?: string) => void,
  onEvent: (name: string) => void = () => {},
) {
  const w = window as any;
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!SR) { onState("error", "Live mode needs Chrome. You can type below."); return () => {}; }
  const rec = new SR();
  rec.lang = "en-NZ";
  rec.continuous = true;
  rec.interimResults = true;
  let stopped = false;
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) onEvent("final");
      if (e.results[i].isFinal) { if (text.split(/\s+/).length >= 2) onFinal(text); }
      else interim += text + " ";
    }
    onInterim(interim.trim());
  };
  rec.onerror = (e: any) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") stopped = true; // don't retry a blocked mic in a loop
    onEvent(`error:${e.error}`);
    if (e.error !== "no-speech" && e.error !== "aborted") onState("error", e.error);
  };
  // Chrome ends the session after silence. Restart it, and retry if the restart throws so the mic never dies silently.
  const restart = (tries: number) => {
    if (stopped) return;
    try { rec.start(); } catch {
      if (tries >= 5) { onState("error", "restart-failed"); return; }
      setTimeout(() => restart(tries + 1), 300);
    }
  };
  rec.onstart = () => { onEvent("start"); onState("on"); };
  rec.onaudiostart = () => onEvent("audio");
  rec.onspeechstart = () => onEvent("speech");
  rec.onend = () => {
    onEvent("end");
    if (stopped) return onState("off");
    setTimeout(() => restart(0), 150);
  };
  rec.start();
  onState("on");
  return () => { stopped = true; rec.stop(); };
}
