from huggingface_hub import snapshot_download

print("Downloading Qwen/Qwen2.5-14B-Instruct-AWQ to /models...")
snapshot_download(
    repo_id="Qwen/Qwen2.5-14B-Instruct-AWQ",
    local_dir="/models/Qwen/Qwen2.5-14B-Instruct-AWQ",
)
print("Finished download!")
