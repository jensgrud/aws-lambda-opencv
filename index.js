var child_process = require('child_process');
var fs = require('fs');
var crypto = require('crypto');
var stream = require('stream');
var path = require('path');
var AWS = require('aws-sdk');
var async = require('async');
var config = require('./config');
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
	console.log('Uploading test', contentType, keyPrefix, bucket);

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
			return cb(null, readStream, filename);
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

function detectFaces(file, cb) {
	console.log('Starting Image processing', file);
	
	cv.readImage(file, function(err, im){
		if (err) throw err;
  		if (im.width() < 1 || im.height() < 1) throw new Error('Image has no size');

  		im.detectObject("haarcascade_frontalface_alt.xml", {}, function(err, faces){
    		if (err) throw err;

    		for (var i = 0; i < faces.length; i++){
      			var face = faces[i];
      			im.ellipse(face.x + face.width / 2, face.y + face.height / 2, face.width / 2, face.height / 2);
    		}

    		im.save(tempDir + '/out.' + config.format.image.extension);
    	
			return cb(err, 'Image saved to ' + tempDir + '/out.' + config.format.image.extension); 
		});
  	});
}

function processImage(s3Event, srcKey, cb) {

	var file = path.join(tempDir, 'download');

	async.series([
		function(cb) {
			var dlStream = downloadStream(s3Event.bucket.name, srcKey, cb);
			dlStream.on('end', function() {
				cb(null, 'download finished');
			});
			dlStream.pipe(fs.createWriteStream(file));
		},
		function(cb) {
			detectFaces(file, cb);
		},
		function(cb) {
			console.log('Deleting download file');
			fs.unlink(file, cb);
		}
	], cb);
}

exports.handler = function(event, context) {

	var s3Event = event.Records[0].s3;
	var srcKey = decodeURIComponent(s3Event.object.key);
	var index = srcKey.lastIndexOf("/");
	var fileName = srcKey.substr(index + 1)
	var keyPrefix = fileName.replace(/\.[^/.]+$/, '');
	var format = config.format;

	async.series([
		function (cb) { processImage(s3Event, srcKey, cb); },
		function (cb) {	
			async.parallel([
				function (cb) { uploadFile(format.image.extension, s3Event.bucket.name + '/' + config.destination, keyPrefix, format.image.mimeType, cb); }
			], cb);
		}
	], function(err, results) {
		if (err) context.fail(err);
		else context.succeed(results);
	});
};
