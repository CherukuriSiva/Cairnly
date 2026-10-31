#!/usr/bin/env bash
# Run the whole stack on a local Kubernetes cluster (kind) with the Helm chart.
# Needs: docker, kind, kubectl, helm. Tear down with: kind delete cluster --name cairnly
set -euo pipefail
cd "$(dirname "$0")/.."

kind get clusters | grep -qx cairnly || kind create cluster --name cairnly
docker build -t cairnly-api:local .
docker build -t cairnly-web:local --build-arg NEXT_PUBLIC_API_URL= web   # same-origin API
kind load docker-image cairnly-api:local cairnly-web:local --name cairnly

helm --kube-context kind-cairnly upgrade --install cairnly infra/helm/cairnly --wait --timeout 10m
kubectl --context kind-cairnly get pods

echo
echo "API:  kubectl --context kind-cairnly port-forward svc/cairnly-api 8010:8010"
echo "UI:   kubectl --context kind-cairnly port-forward svc/cairnly-web 3010:3010"
