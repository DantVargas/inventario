// Lanza la app en modo desarrollo (npm start).
// Quita ELECTRON_RUN_AS_NODE: algunos editores (como VS Code) la dejan definida
// y con ella Electron se comporta como Node y no abre ninguna ventana.
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron'); // en Node, devuelve la ruta al ejecutable

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
