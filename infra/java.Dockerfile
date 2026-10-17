ARG JAVA_IMAGE=eclipse-temurin:21-jdk
FROM ${JAVA_IMAGE} AS build
WORKDIR /build
COPY java/src ./src
RUN javac --add-modules jdk.jdi,jdk.compiler -g -encoding UTF-8 -d /classes src/codeviz/*.java
FROM ${JAVA_IMAGE}
COPY --from=build /classes /opt/codeviz
RUN groupadd --gid 10001 codeviz && useradd --uid 10001 --gid 10001 --no-create-home codeviz
USER 10001:10001
WORKDIR /tmp
