type State = "on" | "off" | "error";

export function listen(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  onState: (s: State, msg?: string) => void,
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
      if (e.results[i].isFinal) { if (text.split(/\s+/).length >= 2) onFinal(text); }
      else interim += text + " ";
    }
    onInterim(interim.trim());
  };
  rec.onerror = (e: any) => { if (e.error !== "no-speech" && e.error !== "aborted") onState("error", e.error); };
  rec.onend = () => { if (stopped) return onState("off"); try { rec.start(); } catch {} }; // Chrome stops after silence
  rec.start();
  onState("on");
  return () => { stopped = true; rec.stop(); };
}
