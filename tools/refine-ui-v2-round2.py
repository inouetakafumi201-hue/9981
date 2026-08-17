#!/usr/bin/env python3
"""
WakeUp UI 设计图 V2 第二轮精修脚本
基于第一轮精修结果，继续改进：
1. 骰子右侧投点对比条：从3条增加到7条，明亮彩色横条（灰/绿/橙/红）
2. 动作卡片右侧图标：移除3×3网格攻击范围图标，替换为标签词条图标
"""

import base64
import httpx
from pathlib import Path
from datetime import datetime

# 配置
env_path = Path(__file__).parent.parent / ".agents/skills/sprite-forge/tools/.env"
API_KEY = None
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if line.startswith("SPRITE_GPT_KEY="):
            API_KEY = line.split("=", 1)[1].strip().strip('"')
            break

if not API_KEY:
    print("✗ 无法读取 API KEY")
    exit(1)

API_BASE = "https://apiclaude.cc/v1"
PROMPT_FILE = Path(__file__).parent.parent / "docs/表现系统/ui_design_v2_refine2_prompt.txt"
INPUT_IMAGE = Path(__file__).parent.parent / "run/ui-mockup/v2-refined/ui_v2_refined_20260815_175907.png"
OUTPUT_DIR = Path(__file__).parent.parent / "run/ui-mockup/v2-refined"

def main():
    print("=" * 60)
    print("WakeUp UI 设计图 V2 第二轮精修")
    print("=" * 60)
    
    # 读取提示词
    prompt = PROMPT_FILE.read_text(encoding="utf-8")
    print(f"提示词长度: {len(prompt)} 字符")
    
    # 检查输入图像
    if not INPUT_IMAGE.exists():
        print(f"✗ 输入图像不存在: {INPUT_IMAGE}")
        return
    
    print(f"原始图像: {INPUT_IMAGE}")
    print(f"图像大小: {INPUT_IMAGE.stat().st_size / 1024:.1f} KB")
    
    # 准备 API 请求
    endpoint = f"{API_BASE}/images/edits"
    print(f"API 端点: {endpoint}")
    
    headers = {
        "Authorization": f"Bearer {API_KEY}",
    }
    
    # 准备 multipart 数据
    with open(INPUT_IMAGE, "rb") as f:
        image_data = f.read()
    
    files = {
        "image": ("image.png", image_data, "image/png"),
        "prompt": (None, prompt),
        "model": (None, "gpt-image-2"),
        "size": (None, "1792x1024"),
        "n": (None, "1"),
    }
    
    print("\n正在精修图像（第二轮）...")
    try:
        with httpx.Client(timeout=180.0) as client:
            response = client.post(endpoint, headers=headers, files=files)
            response.raise_for_status()
            result = response.json()
        
        # 提取图像
        if "data" in result and len(result["data"]) > 0:
            data_item = result["data"][0]
            if "url" in data_item:
                image_url = data_item["url"]
                # 下载图像
                img_response = httpx.get(image_url, timeout=60.0)
                img_response.raise_for_status()
                img_data = img_response.content
            elif "b64_json" in data_item:
                # 直接返回 base64
                img_data = base64.b64decode(data_item["b64_json"])
            else:
                raise KeyError(f"data[0] 中没有 'url' 或 'b64_json': {data_item.keys()}")
            
            # 保存图像
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = OUTPUT_DIR / f"ui_v2_refined2_{timestamp}.png"
            
            with open(output_file, "wb") as f:
                f.write(img_data)
            
            print(f"✓ 成功精修（第二轮）: {output_file}")
            print(f"  文件大小: {len(img_data) / 1024:.1f} KB")
            
        else:
            raise KeyError(f"响应中没有 'data' 字段或为空: {result.keys()}")
            
    except httpx.HTTPStatusError as e:
        print(f"✗ HTTP 错误: {e.response.status_code}")
        print(f"  响应: {e.response.text[:500]}")
    except Exception as e:
        print(f"✗ 发生错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
