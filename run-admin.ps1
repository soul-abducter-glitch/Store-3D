# Запуск админки на порту 3001
$env:NEXT_PUBLIC_SERVER_URL="http://localhost:3001"
$env:NEXT_PUBLIC_CORS_URL="http://localhost:3001"
$env:NEXT_PUBLIC_MODE="admin"
$env:PORT="3001"
npm run dev:admin
