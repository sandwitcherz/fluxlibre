$env:Path += ';C:\Program Files\Git\cmd'
$key = Join-Path $env:USERPROFILE '.ssh\fluxlibre_deploy_key'
$env:GIT_SSH_COMMAND = '"C:\Program Files\Git\usr\bin\ssh.exe" -i "' + $key + '" -o StrictHostKeyChecking=accept-new'
git add -A
git commit -q -m "Corrige extraction description et categorie (plus de texte de carte)"
git push origin merge-master:main
git push origin merge-master:master
