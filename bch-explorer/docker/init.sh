#!/bin/sh

#backend
cp -r ./docker/backend/* ./backend/

#frontend
localhostIP="127.0.0.1"
cp ./docker/frontend/* ./frontend
cp ./nginx.conf ./frontend/
cp ./nginx-explorer.conf ./frontend/
sed -i"" -e "s/${localhostIP}:80/0.0.0.0:__EXPLORER_FRONTEND_HTTP_PORT__/g" ./frontend/nginx.conf
sed -i"" -e "s/${localhostIP}/0.0.0.0/g" ./frontend/nginx.conf
sed -i"" -e "s/user nobody;//g" ./frontend/nginx.conf
sed -i"" -e "s!/etc/nginx/nginx-explorer.conf!/etc/nginx/conf.d/nginx-explorer.conf!g" ./frontend/nginx.conf
sed -i"" -e "s/${localhostIP}:8999/__EXPLORER_BACKEND_MAINNET_HTTP_HOST__:__EXPLORER_BACKEND_MAINNET_HTTP_PORT__/g" ./frontend/nginx-explorer.conf
