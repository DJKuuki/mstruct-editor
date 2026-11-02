const WIDTH = 1920, HEIGHT = 1080, FPS = 30, SAMPLE_RATE = 48000;

function videoEncodingArguments({ frameCount, bgmPath, pianoPath, bgmVolume = 100, output }) {
  const duration = frameCount / FPS;
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "rawvideo", "-pixel_format", "bgra", "-video_size", `${WIDTH}x${HEIGHT}`, "-framerate", String(FPS), "-i", "pipe:0"];
  const tracks = [];
  if (bgmPath) { args.push("-i", bgmPath); tracks.push({ volume: Math.min(100, Math.max(0, bgmVolume)) / 100 }); }
  if (pianoPath) { args.push("-f", "f32le", "-ar", String(SAMPLE_RATE), "-ac", "2", "-i", pianoPath); tracks.push({ volume: 1 }); }
  args.push("-map", "0:v:0");
  if (tracks.length) {
    const gain = tracks.filter(track => track.volume > 0).length > 1 ? 0.707945784 : 1;
    const filters = tracks.map((track, index) => `[${index + 1}:a:0]aresample=${SAMPLE_RATE},volume=${track.volume * gain}[a${index}]`);
    const mix = tracks.length === 1 ? "[a0]" : "[a0][a1]amix=inputs=2:duration=longest:normalize=0,";
    // -3 dB per source when mixed, followed by a -2 dBFS ceiling. Disable
    // automatic makeup gain and compensate limiter latency before AAC encoding.
    filters.push(`${mix}alimiter=limit=0.794328:level=0:latency=1,apad,atrim=duration=${duration}[audio]`);
    args.push("-filter_complex", filters.join(";"), "-map", "[audio]", "-c:a", "aac", "-b:a", "192k");
  } else args.push("-an");
  args.push("-c:v", "h264_mf", "-hw_encoding", "0", "-pix_fmt", "nv12", "-b:v", "10000000", "-g", "60", "-t", String(duration), "-movflags", "+faststart", output);
  return args;
}

module.exports = { WIDTH, HEIGHT, FPS, SAMPLE_RATE, videoEncodingArguments };
