#!/usr/bin/env python3
"""
直接调用 gpt-image-2 生成 UI 设计图
使用 apiclaude.cc 中转
"""
import os
import sys
import json
import base64
from pathlib import Path
from datetime import datetime

try:
    import httpx
except ImportError:
    print("需要安装 httpx: pip install httpx")
    sys.exit(1)

# 读取配置
env_path = Path(__file__).parent.parent / ".agents/skills/sprite-forge/tools/.env"
config = {}
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            config[key.strip()] = val.strip()

BASE_URL = config.get("SPRITE_BASE_URL", "https://apiclaude.cc/")
API_KEY = config.get("SPRITE_GPT_KEY", "")

if not API_KEY:
    print("错误：未找到 SPRITE_GPT_KEY")
    sys.exit(1)

# 读取提示词
prompt_path = Path(__file__).parent.parent / "docs/表现系统/ui_design_v3_prompt.txt"
if not prompt_path.exists():
    print(f"错误：未找到提示词文件 {prompt_path}")
    sys.exit(1)

full_prompt = prompt_path.read_text(encoding="utf-8")

# 提取核心提示词（跳过 markdown 标题）
lines = []
in_content = False
for line in full_prompt.splitlines():
    if line.strip() and not line.startswith("#"):
        in_content = True
    if in_content:
        lines.append(line)

prompt = "\n".join(lines).strip()

print("=" * 60)
print("生成 WakeUp UI 设计图 V3")
print("=" * 60)
print(f"提示词长度: {len(prompt)} 字符")
print(f"API 端点: {BASE_URL}v1/images/generations")
print()

# 调用 API
url = f"{BASE_URL.rstrip('/')}/v1/images/generations"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}
payload = {
    "model": "gpt-image-2",
    "prompt": prompt,
    "n": 1,
    "size": "1792x1024",
    "response_format": "b64_json"
}

print("正在生成图像...")
try:
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        result = resp.json()
        
        if "data" in result and len(result["data"]) > 0:
            b64_img = result["data"][0]["b64_json"]
            img_bytes = base64.b64decode(b64_img)
            
            # 保存到 run/ui-mockup/v3/
            output_dir = Path(__file__).parent.parent / "run/ui-mockup/v3"
            output_dir.mkdir(parents=True, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = output_dir / f"ui_v3_{timestamp}.png"
            output_path.write_bytes(img_bytes)
            
            print(f"✓ 成功生成: {output_path}")
            print(f"  文件大小: {len(img_bytes) / 1024:.1f} KB")
            print()
            print("可以在 VS Code 中打开查看，或拖入浏览器查看。")
        else:
            print("错误：API 返回数据格式异常")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            
except httpx.HTTPStatusError as e:
    print(f"HTTP 错误 {e.response.status_code}:")
    print(e.response.text)
    sys.exit(1)
except Exception as e:
    print(f"错误: {e}")
    sys.exit(1)
