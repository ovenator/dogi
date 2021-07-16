# Dogi

Dogi makes it possible to run code in any git repo via HTTP without deployment or special API in your code.   
Out of the box, you will get an HTTP stream of your build and run logs and HTTP code mapped your script exit code (0 - 200, non-zero - 500).   

You can also reference arbitrary files inside your container and have it streamed to you in real time just like `tail -f`.   
Imagine like scraping a website and have 3 different files, one with the scraped data, second with list of failed urls and third with scrapy logs for debugging.

Dogi also supports HTTP callbacks to notify your app via POST with the result of execution. You can, for example, use free cron service like https://cron-job.org to call your code and notify you about execution errors, while your app will just receive the resulting data on success.

### Demo
The following will checkout the repository, build the Dockerfile, run the command and stream the selected file to you in real time. Optional signature prevents clients from tampering the parameters

https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=all_pages&action=run&output=file_data&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&sig=cab976410e8cb7b2dd85eee67c43d17e6d314c0e
https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=all_pages&action=run&output=log&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&sig=fc18f584ca659bdff8033111677365e8c23d8b34
https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=all_pages&action=run&output=status&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&sig=3d72af23cee53efe1ba4bd60e48fd2e8858e1bd0

Note that if you want to run multiple instances in parallel, you have to supply an id param. If you call run multiple times on the same id, it will just attach to the previous run, not taking into account the changes in parameters. If you want to change the parameters, use action=restart   
https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=max_pages&action=run&output=file_data&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&env_MAX_PAGES=1&sig=e5e4bb1389606c772e5f1cd760a8574ebadb0e05



### Installation
```shell
 docker run -ti 
 -p 3001:3001 \
 -v /tmp:/tmp \
 -v ~/.ssh/id_rsa:/root/.ssh/id_rsa:ro \
 -v /var/run/docker.sock:/var/run/docker.sock \
 -e BYPASS_SIGNATURES=true --rm ovenator/dogi:latest
```

* `-v ~/.ssh/id_rsa:/root/.ssh/id_rsa:ro` - link your private ssh key for access to private repositories
* `-v /tmp:/tmp` - required for handing over the files from inside of the container, if you change this to `-v /foo:/tmp`, you will have to set `HOST_SHARED_DIR=/foo`


### Container ENV params

| Name                      | Default value  | Description   |
| :------------------------ | :------------- | :------------ |
| BYPASS_SIGNATURES         |   **false**    |  If set to true, the 'sig' query param will not be required |
| SIGNATURES_SECRET         |                |  Secret used to sign the url `sha1(secret:/https/mygitrepo?foo=bar)` |
| ADVERTISED_URL            |                |  Base url used in callbacks to reference the the dogi host for downloading output files |
| HOST_SHARED_DIR           |    **/tmp**    | The directory on host machine to be used to store files, should be readable and writable by any user  |


### Query params

| Name                      | Default value  | Description   |
| :------------------------ | :------------- | :------------ |
|   sig                     |                | Must the the last param. Required unless the BYPASS_SIGNATURES env var is set to true. |
|   output                  |   log          | The selected will be tailed to the http reponse. <br/> file_* - tail the selected file inside container Ex. `output=file_myFile` <br/> log - tail the container build and run logs subsequently <br/> status - will hang until the task is finished, then returns 200 or 500 depending if the task succeeded, response will contain links to download output files  |
|   action                  |   peek         | run - run the task, response will be tail of the selected output <br/> peek - just tail the selected output <br/> restart - abort and run subsequently <br/> abort - kill the task |
|   file_*                  |                | Reference file inside container. Ex: `?file_myFile=/app/myFile.json`   |
|   env_*                   |                | Pass environment variable to container. Ex: `?env_FOO=bar` will run container with `FOO` env variable |
|   id                      |                | To be able to reference multiple concurrent runs based on the same git repo |
|   cb                      |                | When execution is finished, this url will be POST called with json payload similar to 'status' output. If the callback returns and error, the entire task will behave as failed |
|   cmd                     |                | Will be passed as cmd command to the container split by spaces. Ex. `?cmd=node run start` will be passed to the container as `CMD [node, run, start`]`  |
|   bashc                   |                | Alias for `CMD [bash, -c, command]`. Ex. `?bashc=command`  |
