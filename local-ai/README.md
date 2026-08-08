# Bundled Local AI

This directory describes the local runtime shipped by the Windows installer. The source repository does not track the GGUF model or executable binaries; the release build downloads the pinned artifacts, verifies SHA256, and places them under the installer resources directory.

## Pinned artifacts

- Model repository: `unsloth/Qwen3-0.6B-GGUF`
- Model revision: `50968a4468ef4233ed78cd7c3de230dd1d61a56b`
- Model file: `Qwen3-0.6B-Q8_0.gguf`
- Model size: `639447744` bytes
- Model SHA256 (Hugging Face Git LFS OID): `e150ed544dfe6016930c026a93913a5e3184181ebfe6ab2223ae01dd0491784c`
- Runtime project: `ggml-org/llama.cpp`
- Runtime release: `b8162`
- Windows asset: `llama-b8162-bin-win-cpu-x64.zip`
- Runtime archive SHA256: `00f2063fc3b4030ce0a475b0225ca08f48360da9493baa135261fd9e12d1cf45`

## Runtime layout

The build output is copied to the external Electron resources directory, never into `app.asar`:

```text
resources/local-ai/
├─ llama-server.exe
├─ ggml*.dll
├─ llama*.dll
├─ libomp140.x86_64.dll
└─ Qwen3-0.6B-Q8_0.gguf
```

The application also keeps a small offline safety set for common learning expressions used by the smoke-test path. Arbitrary phrases still go through the model and validation path, but the 0.6B model's phrase type, component hints, and idiom interpretation are best-effort outputs that may require manual correction or optional DeepSeek enhancement.

## Sources and licenses

- Qwen3 model card and license: <https://huggingface.co/Qwen/Qwen3-0.6B>
- Pinned GGUF repository: <https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/50968a4468ef4233ed78cd7c3de230dd1d61a56b>
- llama.cpp release: <https://github.com/ggml-org/llama.cpp/releases/tag/b8162>
- llama.cpp source license: `LICENSES/LLAMA-CPP-MIT.txt`
- Apache License 2.0 text: `LICENSES/APACHE-2.0.txt`
- Qwen3 model notice: `LICENSES/QWEN3-APACHE-2.0.txt`
- LLVM/libomp notice and exception: `LICENSES/LIBOMP-NOTICE.txt`, `LICENSES/LLVM-EXCEPTION.txt`

The Qwen3 model is distributed under Apache License 2.0. llama.cpp is distributed under the MIT License. The Windows CPU archive also contains `libomp140.x86_64.dll`; its upstream LLVM/OpenMP notices are retained by reference in the bundled license documentation.
