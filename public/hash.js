importScripts('/spark-md5.min.js');
onmessage = (e) => {
    const spark = new SparkMD5.ArrayBuffer();
    const { file } = e.data;
    if (typeof file === 'undefined') {
        postMessage({
            err: 'file is undefined',
        })
    }
    /*for (let i = 0; i < fileSlices.length; ++i) {
        const hash = spark.append(fileSlices[i]);
    }*/
    spark.append(file);
    const hash = spark.end();
    postMessage({
        hash,
    });
}