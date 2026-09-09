// Keep core and addons in one bundle so they share the same Three.js instance.
// These exports become properties of the browser's THREE global.
export * from "three";
export { OrbitControls } from "three/addons/controls/OrbitControls.js";
export { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
export { RenderPass } from "three/addons/postprocessing/RenderPass.js";
export { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
export { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/addons/postprocessing/OutputPass.js";
