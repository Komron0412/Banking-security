'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from 'face-api.js';

export default function FaceVerification() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [livenessScore, setLivenessScore] = useState(0);
  const [message, setMessage] = useState('Starting face verification...');
  const lastPositionsRef = useRef<any[]>([]);
  const blinkCountRef = useRef(0);
  const lastEARRef = useRef<number[]>([]);
  const intervalIdRef = useRef<number | null>(null);

  useEffect(() => {
    const loadModels = async () => {
      try {
        setMessage('Loading face detection models...');
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceExpressionNet.loadFromUri('/models'),
        ]);
        setMessage('Models loaded successfully. Starting camera...');
        setIsLoading(false);
        startVideo();
      } catch (error) {
        console.error('Error loading models:', error);
        setMessage('Error loading face detection models. Please refresh the page.');
      }
    };

    loadModels();

    return () => {
      // Cleanup video stream and intervals
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, []);

  const startVideo = async () => {
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setMessage('Camera started. Position your face in the center of the frame...');
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setMessage('Error accessing camera. Please ensure camera permissions are granted.');
    }
  };

  const handleVideoPlay = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      intervalIdRef.current = window.setInterval(async () => {
        try {
          const options = new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.3,
          });

          const detections = await faceapi
            .detectAllFaces(video, options)
            .withFaceLandmarks()
            .withFaceExpressions();

          const displaySize = { width: video.videoWidth, height: video.videoHeight };
          faceapi.matchDimensions(canvas, displaySize);

          const resizedDetections = faceapi.resizeResults(detections, displaySize);
          const ctx = canvas.getContext('2d');

          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw bounding boxes and facial landmarks
            faceapi.draw.drawDetections(canvas, resizedDetections);
            faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);

            if (resizedDetections.length > 0) {
              const faceLandmarks = resizedDetections[0].landmarks;
              const leftEye = faceLandmarks.getLeftEye();
              const rightEye = faceLandmarks.getRightEye();

              const currentEAR = calculateEAR(leftEye, rightEye);
              updateEARHistory(currentEAR);

              const baselineEAR = calculateBaselineEAR();
              const isEyeClosed = currentEAR < baselineEAR * 0.75;

              drawEyes(ctx, leftEye, rightEye, isEyeClosed);
              updateLivenessScore(resizedDetections[0], currentEAR, baselineEAR);
            } else {
              setMessage('No face detected. Please position your face in the center box.');
            }
          }
        } catch (error) {
          console.error('Error in face detection:', error);
          setMessage('Face detection error. Please ensure good lighting and face the camera.');
        }
      }, 100);
    }
  };

  const calculateEAR = (leftEye: any[], rightEye: any[]) => {
    const getEAR = (eye: any[]) => {
      const v1 = euclideanDistance(eye[1], eye[5]);
      const v2 = euclideanDistance(eye[2], eye[4]);
      const h = euclideanDistance(eye[0], eye[3]);
      return h > 0 ? ((v1 + v2) / (2.0 * h)) * 1.5 : 0;
    };
    return (getEAR(leftEye) + getEAR(rightEye)) / 2.0;
  };

  const euclideanDistance = (pt1: any, pt2: any) => {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
  };

  const updateEARHistory = (currentEAR: number) => {
    lastEARRef.current.push(currentEAR);
    if (lastEARRef.current.length > 10) {
      lastEARRef.current.shift();
    }
  };

  const calculateBaselineEAR = () => {
    const sortedEARs = [...lastEARRef.current].sort((a, b) => b - a);
    return sortedEARs.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  };

  const drawEyes = (ctx: CanvasRenderingContext2D, leftEye: any[], rightEye: any[], isEyeClosed: boolean) => {
    ctx.strokeStyle = isEyeClosed ? 'red' : 'yellow';
    ctx.lineWidth = 2;

    [leftEye, rightEye].forEach((eye) => {
      ctx.beginPath();
      ctx.moveTo(eye[0].x, eye[0].y);
      eye.forEach((pt: any) => ctx.lineTo(pt.x, pt.y));
      ctx.closePath();
      ctx.stroke();
    });
  };

  const updateLivenessScore = (detection: any, currentEAR: number, baselineEAR: number) => {
    const expressions = detection.expressions;
    const blinkCount = detectBlink(detection.landmarks);
    const movement = detectMovement(detection.landmarks);
    const expressionChange = Math.max(expressions.happy, expressions.surprised, expressions.neutral);

    const score = Math.min(blinkCount * 0.3 + movement * 2 + expressionChange * 0.3, 1);
    setLivenessScore(score);

    if (score > 0.7) {
      if (blinkCount < 2) {
        setMessage(`Please blink naturally (${blinkCount}/2 blinks)`);
      } else if (movement < 0.1) {
        setMessage('Please move your head slightly');
      } else {
        setMessage('Live face verified! Natural movements detected.');
      }
    } else {
      setMessage('Position your face in the box and blink naturally');
    }
  };

  const detectBlink = (landmarks: any): number => {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    const currentEAR = calculateEAR(leftEye, rightEye);

    if (lastEARRef.current.length >= 3) {
      const prev = lastEARRef.current[lastEARRef.current.length - 2];
      const threshold = calculateBaselineEAR() * 0.65;

      if (prev > threshold && currentEAR < threshold) {
        blinkCountRef.current += 1;
      }
    }
    return blinkCountRef.current;
  };

  const detectMovement = (landmarks: any) => {
    const nose = landmarks.getNose()[0];
    const currentPosition = { x: nose.x, y: nose.y };

    lastPositionsRef.current.push(currentPosition);
    if (lastPositionsRef.current.length > 10) {
      lastPositionsRef.current.shift();
    }

    if (lastPositionsRef.current.length < 2) return 0;

    let totalMovement = 0;
    for (let i = 1; i < lastPositionsRef.current.length; i++) {
      const prev = lastPositionsRef.current[i - 1];
      const curr = lastPositionsRef.current[i];
      totalMovement += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
    }

    return totalMovement / lastPositionsRef.current.length;
  };

  return (
    <div className="relative w-full max-w-md mx-auto p-4">
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlay={handleVideoPlay}
          className="w-full rounded-lg shadow-lg"
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{ transform: 'scaleX(-1)' }}
        />
      </div>

      <div className="mt-4 p-4 bg-white rounded-lg shadow">
        <p className="text-lg font-semibold text-gray-800">{message}</p>
        <div className="mt-2">
          <p className="text-sm text-gray-600">Liveness Score: {(livenessScore * 100).toFixed(1)}%</p>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full"
              style={{ width: `${livenessScore * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
          <div className="text-white text-lg">Loading face detection models...</div>
        </div>
      )}
    </div>
  );
}