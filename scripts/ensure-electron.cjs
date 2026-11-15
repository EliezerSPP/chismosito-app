#!/usr/bin/env node
/**
 * Electron 45 ya no declara un `postinstall` en su package.json, así que el
 * binario no se descarga al instalar dependencias. Este script ejecuta el
 * instalador oficial (idempotente: si ya está descargado, termina al instante).
 */
const { existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')

const root = resolve(__dirname, '..')
const installer = join(root, 'node_modules', 'electron', 'install.js')

if (!existsSync(installer)) {
  console.error(
    '[chismosito] No se encontró el paquete electron. Ejecuta tu instalador de dependencias (pnpm install / npm install).'
  )
  process.exit(1)
}

execFileSync(process.execPath, [installer], { stdio: 'inherit', cwd: root })
