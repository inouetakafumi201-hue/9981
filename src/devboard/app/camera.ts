/**
 * 编辑器摄像机（viewBox 平移缩放 + 校验摄像机飞）。
 *
 * `01` §九「全局输入」：空格+拖 / 中键拖平移（走 SVG viewBox，不走浏览器滚动）、
 * 滚轮以光标为中心缩放。`01` §九「校验反馈」：点击诊断 → 摄像机飞到问题元素。
 */
import type { Vec2 } from '../ports/map-contracts.js';

/** 归一化画布上的 viewBox（用户空间矩形）。scale 越大视野越窄（越放大）。 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number; // 缩放因子，1 = 满画布
}

export const DEFAULT_CAMERA_WIDTH = 1000;
export const DEFAULT_CAMERA_HEIGHT = 700;

export function defaultCamera(): Camera {
  return {
    x: 0,
    y: 0,
    width: DEFAULT_CAMERA_WIDTH,
    height: DEFAULT_CAMERA_HEIGHT,
    scale: 1,
  };
}

/** 平移（空格 / 中键拖）：把 viewBox 原点移动一个屏幕像素量的归一化偏移。 */
export function pan(camera: Camera, dxScreen: number, dyScreen: number): Camera {
  const ppx = camera.width / DEFAULT_CAMERA_WIDTH;
  const ppy = camera.height / DEFAULT_CAMERA_HEIGHT;
  return { ...camera, x: camera.x - dxScreen * ppx, y: camera.y - dyScreen * ppy };
}

/** 以光标为中心缩放：constrain scale ∈ [0.4, 6]。滚轮 +factor 放大、-factor 缩小。 */
export function zoomAt(camera: Camera, focus: Vec2, factor: number): Camera {
  const nextScale = Math.max(0.4, Math.min(6, camera.scale * factor));
  const ratio = nextScale / camera.scale;
  const fx = focus.x * DEFAULT_CAMERA_WIDTH;
  const fy = focus.y * DEFAULT_CAMERA_HEIGHT;
  // 光标对应 viewBox 中的位置 = camera.x + fx * camera.width / DEFAULT_CAMERA_WIDTH
  const oldVx = camera.x + fx * (camera.width / DEFAULT_CAMERA_WIDTH);
  const oldVy = camera.y + fy * (camera.height / DEFAULT_CAMERA_HEIGHT);
  const newWidth = camera.width / ratio;
  const newHeight = camera.height / ratio;
  const newVx = oldVx - fx * (newWidth / DEFAULT_CAMERA_WIDTH);
  const newVy = oldVy - fy * (newHeight / DEFAULT_CAMERA_HEIGHT);
  return { x: newVx, y: newVy, width: newWidth, height: newHeight, scale: nextScale };
}

/** 校验点击飞：返回目标摄像机（把元素中心放到视野中央保持缩放）+ 飞行时长。 */
export function flyTo(camera: Camera, subject: Vec2, durationMs: number): { to: Camera; duration: number } {
  const sx = subject.x * DEFAULT_CAMERA_WIDTH;
  const sy = subject.y * DEFAULT_CAMERA_HEIGHT;
  const focusedWidth = camera.width / camera.scale; // 当前放大后视野宽度（用户空间）
  const focusedHeight = camera.height / camera.scale;
  const to: Camera = {
    ...camera,
    x: sx - focusedWidth / 2,
    y: sy - focusedHeight / 2,
  };
  return { to, duration: durationMs };
}
