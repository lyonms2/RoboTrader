/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // firebase-admin (gRPC, protobuf) deve rodar como pacote do Node, sem passar pelo bundler
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
