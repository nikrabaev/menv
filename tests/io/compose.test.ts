import { expect, test } from "bun:test";
import { parseComposeServices } from "../../src/io/compose.ts";

const yml = `
services:
  api:
    image: node
    env_file:
      - ./apps/api/.env
    environment:
      - NODE_ENV=production
      - PORT
  postgres:
    image: postgres
    environment:
      POSTGRES_USER: admin
`;

test("extracts services, env_file refs, and environment keys", () => {
  const svcs = parseComposeServices(yml, "docker-compose.yml");
  const api = svcs.find((s) => s.name === "api")!;
  expect(api.envFiles).toEqual(["./apps/api/.env"]);
  expect(api.environmentKeys.sort()).toEqual(["NODE_ENV", "PORT"]);
  const pg = svcs.find((s) => s.name === "postgres")!;
  expect(pg.environmentKeys).toEqual(["POSTGRES_USER"]);
});
