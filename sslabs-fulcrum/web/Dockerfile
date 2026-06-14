FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png /usr/share/nginx/html/
EXPOSE 80
