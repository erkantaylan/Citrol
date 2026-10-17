// Bun's bundler returns the served URL for an imported image.
declare module "*.webp" {
  const url: string;
  export default url;
}
