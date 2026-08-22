"""TTS-free control: real human recordings shipped with the models."""
import os, time, soundfile as sf, sherpa_onnx
R=os.path.dirname(os.path.abspath(__file__)); M=os.path.join(os.path.dirname(R),"models")
SV=os.path.join(M,"sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
WAVS=[("zh",os.path.join(SV,"test_wavs","zh.wav")),("en",os.path.join(SV,"test_wavs","en.wav"))]
def sv():
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(SV,"model.int8.onnx"),tokens=os.path.join(SV,"tokens.txt"),
        language="",use_itn=True,num_threads=4)
def wh(size,lang=""):
    d=os.path.join(M,f"sherpa-onnx-whisper-{size}")
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=os.path.join(d,f"{size}-encoder.int8.onnx"),
        decoder=os.path.join(d,f"{size}-decoder.int8.onnx"),
        tokens=os.path.join(d,f"{size}-tokens.txt"),language=lang,task="transcribe",num_threads=4)
for name,mk in [("sensevoice:auto",sv),("whisper-small:auto",lambda:wh("small")),
                ("whisper-small:zh",lambda:wh("small","zh")),("whisper-small:en",lambda:wh("small","en"))]:
    r=mk()
    print(f"\n--- {name} ---")
    for tag,p in WAVS:
        d,sr=sf.read(p,dtype="float32")
        if d.ndim>1: d=d.mean(axis=1)
        st=r.create_stream(); t=time.time(); st.accept_waveform(sr,d); r.decode_stream(st)
        print(f"  [{tag}] {time.time()-t:.2f}s ({len(d)/sr:.1f}s audio) : {st.result.text.strip()}")
