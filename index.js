var child_process = require('child_process');
var fs = require('fs');
var util = require('util');
var zlib = require('zlib');
var crypto = require('crypto');
var stream = require('stream');
var path = require('path');
var AWS = require('aws-sdk');
var async = require('async');
var config = require('./config');
var scaleFilter = "scale='min(" + config.videoMaxWidth.toString() + "\\,iw):-2'";
var s3 = new AWS.S3();
var tempDir = process.env['TEMP'] || '/tmp';

var cv = require('opencv');

function downloadStream(bucket, file, cb) {
	console.log('Starting download ' + file);

	return s3.getObject({
		Bucket: bucket,
		Key: file
	}).on('error', function(res) {
		cb('S3 download error: ' + JSON.stringify(res));
	}).createReadStream();
}

function s3upload(params, filename, cb) {
	s3.upload(params)
		.on('httpUploadProgress', function(evt) {
			console.log(filename, 'Progress:', evt.loaded, '/', evt.total);
		})
		.send(cb);
}

function uploadFile(fileExt, bucket, keyPrefix, contentType, cb) {
	console.log('Uploading', contentType, keyPrefix, bucket);

	var filename = path.join(tempDir, 'out.' + fileExt);
	var rmFiles = [filename];
	var readStream = fs.createReadStream(filename);

	var params = {
		Bucket: bucket,
		Key: keyPrefix + '.' + fileExt,
		ContentType: contentType,
		CacheControl: 'max-age=31536000' // 1 year (60 * 60 * 24 * 365)
	};

	async.waterfall([
		function(cb) {
			if (!config.gzip)
				return cb(null, readStream, filename);

			var gzipFilename = filename + '.gzip';

			rmFiles.push(gzipFilename);
			params.ContentEncoding = 'gzip';

			var gzipWriteStream = fs.createWriteStream(gzipFilename);

			gzipWriteStream.on('finish', function() {
				cb(null, fs.createReadStream(filename), gzipFilename);
			});

			readStream
				.pipe(zlib.createGzip({level: zlib.Z_BEST_COMPRESSION}))
				.pipe(gzipWriteStream);
		},
		function(fstream, uploadFilename, cb) {
			console.log('Begin hashing', uploadFilename);

			var hash = crypto.createHash('sha256');

			fstream.on('data', function(d) {
				hash.update(d);
			});

			fstream.on('end', function() {
				cb(null, fs.createReadStream(uploadFilename), hash.digest('hex'));
			});
		},
		function(fstream, hashdigest, cb) {
			console.log(filename, 'hashDigest:', hashdigest);
			params.Body = fstream;

			if (hashdigest)
				params.Metadata = {'sha256': hashdigest};

			s3upload(params, filename, cb);
		},
		function(data, cb) {
			console.log(filename, 'complete. Deleting now.');
			async.each(rmFiles, fs.unlink, cb);
		}
	], cb);
}



function ffmpegProcess(description, cb) {
	
var dlFile = path.join(tempDir, 'download');
console.log('Starting Image processing' + description + dlFile);
	cv.readImage(dlFile, function(err, im){
		if (err) throw err;
  		if (im.width() < 1 || im.height() < 1) throw new Error('Image has no size');

  		im.detectObject("haarcascade_frontalface_alt.xml", {}, function(err, faces){
    	if (err) throw err;

    	for (var i = 0; i < faces.length; i++){
      		var face = faces[i];
      		im.ellipse(face.x + face.width / 2, face.y + face.height / 2, face.width / 2, face.height / 2);
    	}

    	im.save(tempDir + '/out.' + config.format.image.extension);
    	console.log('Image saved to ' + tempDir + '/out.' + config.format.image.extension);
	return cb(err, 'Image saved to ' + tempDir + '/out.' + config.format.image.extension); 
 });
});

	
}

function processImage(s3Event, srcKey, cb) {
	var dlFile = path.join(tempDir, 'download');

	async.series([
		function(cb) {
			var dlStream = downloadStream(s3Event.bucket.name, srcKey, cb);
			dlStream.on('end', function() {
				cb(null, 'download finished');
			});
			dlStream.pipe(fs.createWriteStream(dlFile));
		},
		function(cb) {
			ffmpegProcess(config.linkPrefix + '/' + srcKey, cb);
		},
		function(cb) {
			console.log('Deleting download file');
			fs.unlink(dlFile, cb);
		}
	], cb);
}

exports.handler = function(event, context) {
	console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));

	var s3Event = event.Records[0].s3;
	var srcKey = decodeURIComponent(s3Event.object.key);
	var keyPrefix = srcKey.replace(/\.[^/.]+$/, '');
	var format = config.format;

	async.series([
		function (cb) { processImage(s3Event, srcKey, cb); },
		function (cb) {
			var dstBucket = config.destinationBucket;
			async.parallel([
				function (cb) { uploadFile(format.image.extension, s3Event.bucket.name + '/' + dstBucket, keyPrefix, format.image.mimeType, cb); }
			], cb);
		}
	], function(err, results) {
		if (err) context.fail(err);
		else context.succeed(results);
	});
};
