import Hls from "hls.js";
import { useEffect, useRef, useState } from "react";

export function HlsVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    if (!Hls.isSupported()) {
      setError("이 브라우저는 HLS 재생을 지원하지 않습니다.");
      return;
    }
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError("카메라 스트림에 연결하지 못했습니다.");
    });
    return () => hls.destroy();
  }, [src]);
  return (
    <div className="camera-player">
      <video
        ref={ref}
        className="camera-feed"
        autoPlay
        muted
        controls
        playsInline
      />
      {error && <p>{error}</p>}
    </div>
  );
}
