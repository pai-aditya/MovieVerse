# Jenkins controller image for MovieVerse CI, run on the host via colima docker.
# Adds the Docker CLI (talks to the mounted host docker socket — "Docker-outside-
# of-Docker"), Node.js (for npm test/lint), and the CLIs the pipeline shells out to.
FROM jenkins/jenkins:lts-jdk17

USER root

# Docker CLI (client only; daemon is the host's via the mounted socket) + Node 20 + curl/git.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
        > /etc/apt/sources.list.d/docker.list \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli nodejs \
    && rm -rf /var/lib/apt/lists/*

# kubectl — the 'Deploy preview' stage applies a per-branch ArgoCD Application CR
# to the cluster (reached at host.docker.internal:6443 via the mounted kubeconfig).
RUN curl -fsSL "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" \
        -o /usr/local/bin/kubectl \
    && chmod 0755 /usr/local/bin/kubectl

# Import corp CA into the OS trust store AND the Java truststore so that
# jenkins-plugin-cli (and later pipeline HTTP calls) work behind a TLS-
# intercepting proxy.  The CA is optional: if the build arg is not set or
# the file is empty the build still succeeds.
ARG CORP_CA=
COPY ${CORP_CA:-.dockerignore} /tmp/corp-ca.pem
RUN if [ -s /tmp/corp-ca.pem ]; then \
        cp /tmp/corp-ca.pem /usr/local/share/ca-certificates/corp-ca.crt \
        && update-ca-certificates \
        && keytool -importcert -noprompt -trustcacerts \
            -alias corp-ca \
            -keystore "$JAVA_HOME/lib/security/cacerts" \
            -storepass changeit \
            -file /tmp/corp-ca.pem; \
    fi && rm -f /tmp/corp-ca.pem

# Skip the setup wizard; configuration comes from JCasC (casc.yaml) + plugins.txt.
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
ENV CASC_JENKINS_CONFIG=/var/jenkins_home/casc.yaml

COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

USER jenkins
