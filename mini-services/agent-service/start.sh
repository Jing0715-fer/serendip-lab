#!/usr/bin/env bash
# Task 31：agent-service 守护启动（脱离工具 shell 的会话/进程组，输出重定向到 agent-dev.log）
# 用法：./start.sh  （幂等：已有实例在跑则先杀再启）
cd "$(dirname "$0")"
pkill -f "bun --hot index.ts" 2>/dev/null
sleep 1
setsid nohup bun --hot index.ts >> agent-dev.log 2>&1 < /dev/null &
disown
echo "started, log: $(pwd)/agent-dev.log"
