# ==============================================================================
# PRISM Governed Visual Desktop Sandbox — Dockerfile
# Base: Debian 12 Bookworm Slim + Openbox + KasmVNC WebRTC + Chromium
# Tag: prism-sandbox-desktop:debian-slim
# ==============================================================================

FROM debian:bookworm-slim

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:1 \
    VNC_PORT=5901 \
    WEBRTC_PORT=6080 \
    RESOLUTION=1920x1080 \
    COLOR_DEPTH=24 \
    USER=prism \
    HOME=/home/prism

# Install core X11, Openbox, display utilities, audio, network tools, and frame-grabbers
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg \
    procps \
    locales \
    sudo \
    supervisor \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    openbox \
    tint2 \
    xterm \
    feh \
    dbus-x11 \
    xdotool \
    wmctrl \
    x11-utils \
    x11-apps \
    scrot \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    git \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    fonts-dejavu-core \
    chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root system user 'prism' (UID 1000)
RUN groupadd -g 1000 prism && \
    useradd -u 1000 -g prism -m -s /bin/bash prism && \
    echo "prism ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/prism && \
    chmod 0440 /etc/sudoers.d/prism

# Setup Openbox environment & supervisor directories
RUN mkdir -p /home/prism/.config/openbox /etc/supervisor/conf.d /var/log/prism /tmp/.X11-unix && \
    chmod 1777 /tmp/.X11-unix && \
    chown -R prism:prism /home/prism /var/log/prism

# Copy supervisor and Openbox configuration
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY autostart /home/prism/.config/openbox/autostart
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh /home/prism/.config/openbox/autostart && \
    chown -R prism:prism /home/prism/.config

WORKDIR /home/prism
USER prism

EXPOSE 5901 6080 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
