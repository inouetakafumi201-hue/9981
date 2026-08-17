#!/usr/bin/env python3
"""
WakeUp UI 设计图 V2 精修脚本
使用 gpt-image-2 的图生图能力对 V2-B 进行局部修改
"""
import os
import sys
import json
import base64
from pathlib import Path
from datetime import datetime
import httpx

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent
OUTPUT_DIR = PROJECT_ROOT / "run" / "ui-mockup" / "v2-refined"
INPUT_IMAGE = PROJECT_ROOT / "run" / "ui-mockup" / "v2" / "ui_v2_B.png"

# 读取配置（与 generate-ui-mockup.py 一致）
env_path = PROJECT_ROOT / ".agents/skills/sprite-forge/tools/.env"
config = {}
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            config[key.strip()] = val.strip()

API_BASE = config.get("SPRITE_BASE_URL", "https://apiclaude.cc/").rstrip("/")
API_KEY = config.get("SPRITE_GPT_KEY", "")

if not API_KEY:
    print("错误：未找到 SPRITE_GPT_KEY")
    sys.exit(1)

def main():
    print("=" * 60)
    print("精修 WakeUp UI 设计图 V2-B")
    print("=" * 60)
    
    # 创建输出目录
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # 读取提示词
    prompt_file = PROJECT_ROOT / "docs" / "表现系统" / "ui_design_v2_refined_prompt.txt"
    with open(prompt_file, "r", encoding="utf-8") as f:
        prompt = f.read().strip()
    
    print(f"提示词长度: {len(prompt)} 字符")
    
    # 读取原始图像并编码为 base64
    with open(INPUT_IMAGE, "rb") as f:
        image_data = f.read()
    image_b64 = base64.b64encode(image_data).decode("utf-8")
    
    print(f"原始图像: {INPUT_IMAGE}")
    print(f"图像大小: {len(image_data) / 1024:.1f} KB")
    
    # 调用 gpt-image-2 图生图 API
    endpoint = f"{API_BASE}/v1/images/edits"
    print(f"API 端点: {endpoint}")
    
    # 构建 multipart/form-data 请求
    files = {
        'image': ('source.png', image_data, 'image/png'),
        'prompt': (None, prompt),
        'model': (None, 'gpt-image-2'),
        'size': (None, '1792x1024'),
        'n': (None, '1'),
    }
    
    headers = {
        "Authorization": f"Bearer {API_KEY}"
    }
    
    print("\n正在精修图像...")
    try:
        with httpx.Client(timeout=180.0) as client:
            response = client.post(endpoint, headers=headers, files=files)
            response.raise_for_status()
            result = response.json()
        
        # 调试：打印返回结构
        print(f"API 响应: {json.dumps(result, indent=2, ensure_ascii=False)[:500]}")
        
        # 提取图像 URL 或 base64
        if "data" in result and len(result["data"]) > 0:
            data_item = result["data"][0]
            if "url" in data_item:
                image_url = data_item["url"]
            elif "b64_json" in data_item:
                # 如果返回的是 base64
                img_data = base64.b64decode(data_item["b64_json"])
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                output_file = OUTPUT_DIR / f"ui_v2_refined_{timestamp}.png"
                with open(output_file, "wb") as f:
                    f.write(img_data)
                print(f"✓ 成功精修: {output_file}")
                print(f"  文件大小: {len(img_data) / 1024:.1f} KB")
                return
            else:
                raise KeyError(f"data[0] 中没有 'url' 或 'b64_json': {data_item.keys()}")
        else:
            raise KeyError(f"响应中没有 'data' 字段或为空: {result.keys()}")
        
        # 下载图像
        with httpx.Client() as client:
            img_response = client.get(image_url)
            img_response.raise_for_status()
            img_data = img_response.content
        
        # 保存图像
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = OUTPUT_DIR / f"ui_v2_refined_{timestamp}.png"
        with open(output_file, "wb") as f:
            f.write(img_data)
        
        print(f"✓ 成功精修: {output_file}")
        print(f"  文件大小: {len(img_data) / 1024:.1f} KB")
        print("\n可以在 VS Code 中打开查看，或拖入浏览器查看。")
        
    except httpx.HTTPStatusError as e:
        print(f"✗ API 请求失败: {e.response.status_code}")
        print(f"  响应内容: {e.response.text}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ 发生错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
