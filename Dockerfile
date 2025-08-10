FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    git \
    wget \
    curl \
    unzip \
    awscli \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3 /usr/bin/python

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

RUN useradd -m -u 1000 user
RUN mkdir -p /home/user/app/bert /home/user/app/models /home/user/app/slm /home/user/app/configs /home/user/app/public/audio

WORKDIR /home/user/app

RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir "torch<2.4" "torchaudio<2.4" --index-url https://download.pytorch.org/whl/cu118
RUN pip install --no-cache-dir boto3 botocore GPUtil psutil python-frontmatter markdown beautifulsoup4

COPY r2_utils.py /home/user/
COPY Style-Bert-VITS2-GitHub-Actions/tts_synthesizer.py /home/user/app/
COPY astro_tts_processor.py /home/user/app/

COPY --chown=user . /home/user/app/
RUN chown -R user:user /home/user/app

USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH

RUN if [ -f "Style-Bert-VITS2-GitHub-Actions/requirements.txt" ]; then \
    pip install --no-cache-dir -r Style-Bert-VITS2-GitHub-Actions/requirements.txt; \
fi

USER root

RUN mkdir -p /home/user/app/bert /home/user/app/configs
RUN wget -O /home/user/app/bert/bert_models.json https://raw.githubusercontent.com/litagin02/Style-Bert-VITS2/master/bert/bert_models.json || echo "Failed to download bert_models.json"
RUN wget -O /home/user/app/configs/default_paths.yml https://raw.githubusercontent.com/litagin02/Style-Bert-VITS2/master/configs/default_paths.yml || echo "Failed to download default_paths.yml"
RUN chown -R user:user /home/user/app/bert /home/user/app/configs

USER user

RUN echo '#!/bin/bash\n\
set -e\n\
echo "Setting up TTS environment..."\n\
if [ ! -z "$R2_ENDPOINT_URL" ] && [ ! -z "$AWS_ACCESS_KEY_ID" ]; then\n\
    echo "Downloading models from R2..."\n\
    python3 /home/user/r2_utils.py download-models || echo "Model download failed"\n\
fi\n\
exec "$@"\n\
' > /home/user/startup.sh && chmod +x /home/user/startup.sh

CMD ["/home/user/startup.sh", "/bin/bash"]