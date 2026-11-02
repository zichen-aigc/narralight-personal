import test from "node:test";
import assert from "node:assert/strict";
import { validateProbe } from "../src/media.mjs";

function validProbe() {
  return {
    streams: [
      { codec_type: "video", codec_name: "h264", width: 864, height: 480, avg_frame_rate: "24/1", nb_frames: "124" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "32000", channels: 2 },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5.166667" },
  };
}

test("media gate accepts only the fixed audio-video contract", () => {
  const metadata = validateProbe(validProbe());
  assert.equal(metadata.video.frames, 124);
  assert.equal(metadata.audio.sampleRate, 32000);
  const missingAudio = validProbe();
  missingAudio.streams.pop();
  assert.throws(() => validateProbe(missingAudio), { code: "media_audio_missing" });
  const wrongSize = validProbe();
  wrongSize.streams[0].width = 1920;
  assert.throws(() => validateProbe(wrongSize), { code: "media_dimensions_invalid" });
  const unknownFrames = validProbe();
  delete unknownFrames.streams[0].nb_frames;
  assert.throws(() => validateProbe(unknownFrames), { code: "media_frame_count_invalid" });
});
