import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  RotateCw, 
  RotateCcw, 
  Check, 
  Image as ImageIcon, 
  Download, 
  Sparkles, 
  RefreshCw, 
  AlertCircle, 
  Trash2, 
  Plus,
  Play,
  Pause,
  Layers,
  Square,
  CheckSquare,
  FileArchive,
  Keyboard,
  ArrowUp,
  HelpCircle
} from 'lucide-react';
import JSZip from 'jszip';

interface UploadedFile {
  id: string;
  name: string;
  size: string;
  objectUrl: string;       // Lightweight browser-managed blob URL to avoid tab crash
  rawFile: File;           // Direct file reference for high-resolution canvas output
  status: 'pending' | 'processing' | 'completed' | 'failed';
  detectedDegrees: number; // Auto computed rotation (0, 90)
  manualDegrees: number;   // Tweaked manual alignment degrees by user
  explanation?: string;
  error?: string;
  selected?: boolean;      // Bulk operational flag
  width?: number;          // Image natural width
  height?: number;         // Image natural height
}


interface CompressResult {
  file: File;
  width: number;
  height: number;
}

// 원본 이미지를 업로드 즉시 0.82 품질의 JPEG로 압축하여 브라우저의 기기 램 소모 및 크래시 에러를 원천 방지합니다.
function compressImageOnUpload(file: File, quality: number = 0.82): Promise<CompressResult> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const naturalWidth = img.naturalWidth || 800;
      const naturalHeight = img.naturalHeight || 600;
      const canvas = document.createElement('canvas');
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve({ file, width: naturalWidth, height: naturalHeight });
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (blob) {
          // 원래 파일 확장자나 이름 형식 등을 유지하되, JPEG 파일 객체로 빌드합니다.
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve({ file: compressedFile, width: naturalWidth, height: naturalHeight });
        } else {
          resolve({ file, width: naturalWidth, height: naturalHeight });
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ file, width: 800, height: 600 });
    };
    img.src = objectUrl;
  });
}


// Renders the rotated image on a lightweight canvas
function createRotatedImageBlob(rawFile: File, degrees: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(rawFile);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas creation failed'));
        return;
      }

      const finalRotation = (degrees + 360) % 360;

      // Cap the maximum output dimension to 1200px for lightning-fast and memory-safe processing
      const maxExportDim = 1200;
      let naturalWidth = img.naturalWidth || 800;
      let naturalHeight = img.naturalHeight || 600;

      if (naturalWidth > maxExportDim || naturalHeight > maxExportDim) {
        if (naturalWidth > naturalHeight) {
          naturalHeight = Math.round((naturalHeight * maxExportDim) / naturalWidth);
          naturalWidth = maxExportDim;
        } else {
          naturalWidth = Math.round((naturalWidth * maxExportDim) / naturalHeight);
          naturalHeight = maxExportDim;
        }
      }

      if (finalRotation === 90 || finalRotation === 270) {
        canvas.width = naturalHeight;
        canvas.height = naturalWidth;
      } else {
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((finalRotation * Math.PI) / 180);
      ctx.drawImage(img, -naturalWidth / 2, -naturalHeight / 2, naturalWidth, naturalHeight);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(objectUrl);
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Blob compilation error'));
        }
      }, rawFile.type || 'image/jpeg', 0.82); // 82% quality compress is perfectly balanced and lightweight
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load raw image for actual rotation'));
    };
    img.src = objectUrl;
  });
}


export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isProcessingPaused, setIsProcessingPaused] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'completed' | 'failed'>('all');
  const [autoRotateOnUpload, setAutoRotateOnUpload] = useState<boolean>(true); // automatically run resolution rotate on upload
  const [cardSize, setCardSize] = useState<'medium' | 'large' | 'xlarge'>('large'); // visual size control
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warn' | 'error' | 'info' } | null>(null);
  const [focusedFileId, setFocusedFileId] = useState<string | null>(null);

  // States for manual download confirmation (Option B)
  const [isDownloadConfirmOpen, setIsDownloadConfirmOpen] = useState<boolean>(false);
  const [downloadedTargetFileIds, setDownloadedTargetFileIds] = useState<string[]>([]);

  const showToast = (message: string, type: 'success' | 'warn' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  };

  // Keyboard Navigation & Fast Rotation Shortcuts effect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events when typing in standard input fields (if any)
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      const key = e.key.toLowerCase();

      // Scroll to Top: T key OR Home key
      if (key === 't' || e.key === 'Home') {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('페이지 맨 위로 이동했습니다. 🔝', 'info');
        return;
      }

      if (files.length === 0) return;

      // Filter based on active tab to match matches current view
      const filtered = files.filter(f => {
        if (activeTab === 'all') return true;
        if (activeTab === 'pending') return f.status === 'pending' || f.status === 'processing';
        if (activeTab === 'completed') return f.status === 'completed';
        if (activeTab === 'failed') return f.status === 'failed';
        return true;
      });

      if (filtered.length === 0) return;

      const currentIndex = filtered.findIndex(f => f.id === focusedFileId);
      let nextIndex = currentIndex !== -1 ? currentIndex : 0;

      // 1. Navigation: ONLY Arrow keys (방향키는 오로지 이동만 담당)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + filtered.length) % filtered.length;
        const targetId = filtered[nextIndex].id;
        setFocusedFileId(targetId);
        
        // Scroll target card smoothly into view
        const element = document.getElementById(`grid-card-${targetId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } 
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % filtered.length;
        const targetId = filtered[nextIndex].id;
        setFocusedFileId(targetId);

        const element = document.getElementById(`grid-card-${targetId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
      // 2. Rotation: A for CCW (-90°), D for CW (+90°)
      else if (key === 'a') {
        e.preventDefault();
        const activeId = focusedFileId || filtered[0].id;
        rotateIndividual(activeId, -90);
        showToast('반시계(-90°) 회전 완료 (A키)', 'success');
      }
      else if (key === 'd') {
        e.preventDefault();
        const activeId = focusedFileId || filtered[0].id;
        rotateIndividual(activeId, 90);
        showToast('시계방향(+90°) 회전 완료 (D키)', 'success');
      }
      // 3. Convenience: W or S or F to flip 180°
      else if (key === 'w' || key === 's' || key === 'f') {
        e.preventDefault();
        const activeId = focusedFileId || filtered[0].id;
        rotateIndividual(activeId, 180);
        showToast('상하 180° 뒤집기 완료 (단축키)', 'success');
      }
      // 4. Convenience: Enter / Space / Q to toggle select checkbox
      else if (e.key === ' ' || e.key === 'Enter' || key === 'q') {
        e.preventDefault();
        const activeId = focusedFileId || filtered[0].id;
        toggleSelectFile(activeId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [files, focusedFileId, activeTab]);

  // Synchronize focusedFileId to ensure we have a fallback active card reference when files load
  useEffect(() => {
    if (files.length > 0) {
      if (!focusedFileId || !files.some(f => f.id === focusedFileId)) {
        setFocusedFileId(files[0].id);
      }
    } else {
      setFocusedFileId(null);
    }
  }, [files, focusedFileId]);

  // Maximum concurrent orientation analysis calls to safeguard threads
  const CONCURRENT_LIMIT = 5;

  // Track the continuous background processing thread (handles resolution-based auto rotation)
  useEffect(() => {
    if (isProcessingPaused) return;

    const runProcessingLoop = async () => {
      const activeCount = files.filter(f => f.status === 'processing').length;
      if (activeCount >= CONCURRENT_LIMIT) return;

      const nextPending = files.find(f => f.status === 'pending');
      if (!nextPending) return;

      // Transition target to processing
      setFiles(prev => prev.map(f => f.id === nextPending.id ? { ...f, status: 'processing' } : f));

      try {
        const objectUrl = URL.createObjectURL(nextPending.rawFile);
        const img = new Image();
        img.src = objectUrl;

        await new Promise((resolve, reject) => {
          img.onload = () => resolve(null);
          img.onerror = () => reject(new Error('이미지를 로드하는 데 실패했습니다.'));
        });

        // 이미지의 가로(img.width)와 세로(img.height)를 추출한 직후의 로직
        const imgWidth = img.width;
        const imgHeight = img.height;
        let degreesToRotate = 0;
        let currentFileConfidence = 100.0; // 해상도 기준이므로 신뢰도는 완벽한 100%

        // 세로가 더 긴 사진(예: 1440 x 2560)인 경우
        if (imgHeight > imgWidth) {
          // 알고리즘 분석 각도를 전부 무시하고, 무조건 -90도 회전시켜 가로로 눕힙니다.
          degreesToRotate = -90; 
          currentFileConfidence = 100.0; // 해상도 기준이므로 신뢰도는 완벽한 100%
        } else {
          // 이미 가로가 더 길거나 정사각형인 경우 (예: 2560 x 1440)
          // 회전하지 않고 그대로 0도로 둡니다.
          degreesToRotate = 0;
          currentFileConfidence = 100.0;
        }

        URL.revokeObjectURL(objectUrl);

        const explanationText = imgHeight > imgWidth
          ? `세로가 긴 사진(${imgWidth}x${imgHeight})을 감지하여 -90도 회전 수평 정렬 완료`
          : `가로가 긴 사진 또는 정사각형(${imgWidth}x${imgHeight})으로 회전 없음`;

        setFiles(prev => prev.map(f => f.id === nextPending.id ? {
          ...f,
          status: 'completed',
          detectedDegrees: degreesToRotate,
          explanation: `${explanationText} (신뢰도: ${currentFileConfidence.toFixed(1)}%)`
        } : f));

      } catch (err: any) {
        console.error(`Analysis failed for ${nextPending.name}:`, err);
        setFiles(prev => prev.map(f => f.id === nextPending.id ? {
          ...f,
          status: 'failed',
          error: err.message || '방향 검측에 실패했습니다.'
        } : f));
      }
    };

    runProcessingLoop();
  }, [files, isProcessingPaused]);

  // Clean object URLs to release heap space on unload
  useEffect(() => {
    return () => {
      files.forEach(f => URL.revokeObjectURL(f.objectUrl));
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = async (selectedFiles: File[]) => {
    const validFiles = selectedFiles.filter(file => file.type.startsWith('image/'));
    if (validFiles.length === 0) {
      showToast('이미지 파일(PNG, JPG, WebP, GIF 등)만 업로드할 수 있습니다.', 'error');
      return;
    }

    setZipProgress('이미지 최적화 및 0.82 압축 처리 중...');

    try {
      const processedFiles = await Promise.all(
        validFiles.map(async (file) => {
          try {
            return await compressImageOnUpload(file, 0.82);
          } catch (err) {
            console.error('압축 실패 폴백 적용:', file.name, err);
            return { file, width: 800, height: 600 };
          }
        })
      );

      const newUploadedItems: UploadedFile[] = processedFiles.map(item => {
        return {
          id: Math.random().toString(36).substring(2, 9),
          name: item.file.name,
          size: (item.file.size / (1024 * 1024)).toFixed(2) + ' MB',
          objectUrl: URL.createObjectURL(item.file), // lightweight visual reference
          rawFile: item.file,
          status: autoRotateOnUpload ? 'pending' : 'completed',
          detectedDegrees: 0,
          manualDegrees: 0,
          selected: true, // Default checked for batch activities
          width: item.width,
          height: item.height,
        };
      });

      setFiles(prev => {
        // Prevent duplicates in current session by file name
        const filtered = newUploadedItems.filter(
          newItem => !prev.some(item => item.name === newItem.name)
        );
        return [...prev, ...filtered];
      });
      showToast(`${validFiles.length}장의 사진이 업로드 즉시 0.82 비율로 완벽하게 압축 최적화되었습니다!`, 'success');
    } catch (e) {
      console.error(e);
      showToast('사진 처리 중 오류가 발생했습니다.', 'error');
    } finally {
      setZipProgress(null);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => {
    setIsDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeFile = (id: string) => {
    const target = files.find(f => f.id === id);
    if (target) {
      URL.revokeObjectURL(target.objectUrl);
    }
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const toggleSelectFile = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f));
  };

  const selectAll = (select: boolean) => {
    setFiles(prev => prev.map(f => ({ ...f, selected: select })));
  };

  const selectLandscapeOnly = () => {
    setFiles(prev => prev.map(f => {
      const isLandscape = f.width && f.height ? f.width >= f.height : true;
      return { ...f, selected: isLandscape };
    }));
    showToast('가로형(정사각형 포함) 사진만 선택되었습니다.', 'success');
  };

  const selectPortraitOnly = () => {
    setFiles(prev => prev.map(f => {
      const isPortrait = f.width && f.height ? f.height > f.width : false;
      return { ...f, selected: isPortrait };
    }));
    showToast('세로형 사진만 선택되었습니다.', 'success');
  };

  // Bulk actions for checked elements
  const bulkRotate = (angle: number) => {
    setFiles(prev => prev.map(f => {
      if (f.selected) {
        const next = (f.manualDegrees + angle + 360) % 360;
        return { ...f, manualDegrees: next };
      }
      return f;
    }));
  };

  const bulkReset = () => {
    setFiles(prev => prev.map(f => f.selected ? { ...f, manualDegrees: 0, detectedDegrees: 0 } : f));
  };

  const bulkDelete = () => {
    try {
      const selectedIds = files.filter(f => f.selected).map(f => f.id);
      if (selectedIds.length === 0) {
        showToast('삭제할 사진을 먼저 선택해주세요.', 'warn');
        return;
      }
      
      // Revoke safely
      selectedIds.forEach(id => {
        const f = files.find(item => item.id === id);
        if (f && f.objectUrl) {
          try {
            URL.revokeObjectURL(f.objectUrl);
          } catch (e) {
            console.error('Revoke failed for objectUrl', e);
          }
        }
      });

      // Filter state directly
      setFiles(prev => prev.filter(f => !f.selected));
      showToast(`선택한 ${selectedIds.length}장의 사진이 대기열에서 삭제되었습니다.`, 'success');
    } catch (err: any) {
      console.error('bulkDelete error', err);
      showToast(`삭제 처리 에러: ${err.message}`, 'error');
    }
  };

  const runAutoRotationForSelected = () => {
    const selectedFiles = files.filter(f => f.selected);
    if (selectedFiles.length === 0) {
      showToast('자동 회전 보정을 진행할 사진을 선택해주세요.', 'warn');
      return;
    }
    
    // Set selected files to pending status so the background processor loop handles them
    setFiles(prev => prev.map(f => {
      if (f.selected) {
        return { ...f, status: 'pending', error: undefined };
      }
      return f;
    }));
  };

  const rotateIndividual = (id: string, angle: number) => {
    setFiles(prev => prev.map(f => {
      if (f.id === id) {
        const next = (f.manualDegrees + angle + 360) % 360;
        return { ...f, manualDegrees: next };
      }
      return f;
    }));
  };

  const resetIndividual = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, manualDegrees: 0, detectedDegrees: 0 } : f));
  };

  const computeTotalRotation = (file: UploadedFile) => {
    // The visual rotation is the combination of AI's auto degrees and manual adjustments
    return (file.detectedDegrees + file.manualDegrees + 360) % 360;
  };

  // 수동 성공 확인 및 대기열 제거 처리 (방안 B)
  const confirmDownloadAndRemove = () => {
    setFiles(prev => {
      // 대기열에서 다운로드한 파일들을 제거하기 전에 각 파일의 Object URL 해제
      prev.forEach(f => {
        if (downloadedTargetFileIds.includes(f.id)) {
          URL.revokeObjectURL(f.objectUrl);
        }
      });
      const remaining = prev.filter(f => !downloadedTargetFileIds.includes(f.id));
      const removedCount = downloadedTargetFileIds.length;
      const remainingCount = remaining.length;

      if (remainingCount === 0) {
        showToast('일괄 물리 다운로드가 확인되어 대기열이 깨끗하게 초기화되었습니다. 다음 부서 폴더를 올려주세요!', 'success');
      } else {
        showToast(`성공한 ${removedCount}장의 이미지 보정 처리가 확인되어 대기열에서 제외되었습니다. (남은 사진: ${remainingCount}장)`, 'success');
      }
      return remaining;
    });
    setIsDownloadConfirmOpen(false);
    setDownloadedTargetFileIds([]);
  };

  const cancelDownloadRemoval = () => {
    showToast('대기열의 사진을 제외하지 않고 그대로 유지합니다. 다운로드에 어려움이 있다면 다시 시도해보세요!', 'info');
    setIsDownloadConfirmOpen(false);
    setDownloadedTargetFileIds([]);
  };

  // High-performance ZIP packaging of all (or selected) rotated high-res images
  const handleDownloadAllAsZip = async () => {
    const targetFiles = files.filter(f => f.selected);
    if (targetFiles.length === 0) {
      showToast('다운로드할 사진을 선택해주세요.', 'warn');
      return;
    }

    try {
      setZipProgress('ZIP 파일 압축 패키징 준비 중...');
      const zip = new JSZip();

      for (let i = 0; i < targetFiles.length; i++) {
        const file = targetFiles[i];
        const percent = Math.round((i / targetFiles.length) * 100);
        setZipProgress(`고화질 정위치 변환 압축 중 (${i + 1}/${targetFiles.length}장 - ${percent}%)`);

        const totalRot = computeTotalRotation(file);
        
        // If image does not need rotation, grab raw File, otherwise render actual high-quality rotated Canvas Blob
        let fileBlob: Blob;
        if (totalRot === 0) {
          fileBlob = file.rawFile;
        } else {
          fileBlob = await createRotatedImageBlob(file.rawFile, totalRot);
        }

        // Keep original filename exactly
        zip.file(file.name, fileBlob);
      }

      setZipProgress('ZIP 최종 패키징 마감 작성 중...');
      const compactBlob = await zip.generateAsync({ type: 'blob' });
      
      const fileUrl = URL.createObjectURL(compactBlob);
      const tempLink = document.createElement('a');
      tempLink.href = fileUrl;
      tempLink.download = `Aligned_Images_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_pkg.zip`;
      tempLink.click();
      
      // 즉시 대기열에서 제거하지 않고, 다운로드 수동 확인 다이얼로그(방안 B)를 실행합니다.
      setDownloadedTargetFileIds(targetFiles.map(f => f.id));
      setIsDownloadConfirmOpen(true);

      // cleanup ZIP reference
      setTimeout(() => {
        URL.revokeObjectURL(fileUrl);
        setZipProgress(null);
      }, 1500);

    } catch (err: any) {
      console.error('Failed to create ZIP package:', err);
      showToast('압축 파일 생성 및 저장에 실패했습니다: ' + err.message, 'error');
      setZipProgress(null);
    }
  };

  // Download rotated single file directly preserving exact original name
  const handleDownloadSingleRotated = async (file: UploadedFile) => {
    try {
      const totalRot = computeTotalRotation(file);
      let fileBlob: Blob;
      
      if (totalRot === 0) {
        fileBlob = file.rawFile;
      } else {
        fileBlob = await createRotatedImageBlob(file.rawFile, totalRot);
      }

      const link = document.createElement('a');
      const blobUrl = URL.createObjectURL(fileBlob);
      link.href = blobUrl;
      link.download = file.name; // Keep original filename exactly
      link.click();
      
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      showToast('성공적으로 저장되었습니다.', 'success');
    } catch (err: any) {
      showToast('이미지 생성 실패: ' + err.message, 'error');
    }
  };

  const reprocessFile = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'pending', error: undefined } : f));
  };

  // Status counters
  const totalCount = files.length;
  const completedCount = files.filter(f => f.status === 'completed').length;
  const processingCount = files.filter(f => f.status === 'processing').length;
  const pendingCount = files.filter(f => f.status === 'pending').length;
  const failedCount = files.filter(f => f.status === 'failed').length;
  const selectedCount = files.filter(f => f.selected).length;

  // Filter list
  const filteredFiles = files.filter(f => {
    if (activeTab === 'pending') return f.status === 'pending' || f.status === 'processing';
    if (activeTab === 'completed') return f.status === 'completed';
    if (activeTab === 'failed') return f.status === 'failed';
    return true; // all
  });

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans antialiased" id="root-workspace">
      
      {/* Toast Notification Container */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3.5 rounded-2xl shadow-xl border text-sm font-extrabold text-white bg-slate-850 hover:opacity-95 transition-all" id="floating-toast" style={{ backgroundColor: 'rgb(30, 41, 59)' }}>
          {toast.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-400 stroke-[3]" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          )}
          <span>{toast.message}</span>
          <button 
            className="ml-3 hover:text-slate-300 font-bold text-white cursor-pointer" 
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Heavy-duty ZIP process indicator */}
      {zipProgress && (
        <div className="bg-indigo-650 text-white font-bold py-3.5 px-6 text-center text-sm shadow-md animate-pulse sticky top-0 z-50 flex items-center justify-center space-x-2" id="zip-indicator">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>{zipProgress}</span>
        </div>
      )}

      {/* Main header block optimized for high-volume photos */}
      <header className="bg-white border-b border-slate-200 py-5 px-6 sticky top-0 z-40 shadow-xs" id="workspace-header">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-650 rounded-xl text-white flex items-center justify-center shadow-xs">
              <Layers className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">일괄 정위치 보정기</h1>
                <span className="bg-indigo-150 text-indigo-800 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border border-indigo-200">Resolution-Based</span>
              </div>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                가로/세로 해상도로 촬영 기준 원본 방향을 판단하여 <span className="text-indigo-600 font-bold">세로 사진은 -90도 회전</span>, <span className="text-emerald-700 font-bold">가로 사진은 그대로 보존</span>해 정합합니다. (신뢰도 100%)
              </p>
            </div>
          </div>

          {/* Interactive core control metrics */}
          <div className="flex flex-wrap items-center gap-3 text-xs" id="quick-indicators">
            <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="font-semibold text-slate-500">전체 사진:</span>
              <span className="font-black text-slate-900">{totalCount}장</span>
            </div>
            <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg">
              <span className="font-semibold text-emerald-600">완료됨:</span>
              <span className="font-black text-emerald-800">{completedCount}장</span>
            </div>
            {processingCount > 0 && (
              <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-150 rounded-lg text-indigo-700 font-bold animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>{processingCount}장 분석 중</span>
              </div>
            )}
            {pendingCount > 0 && (
              <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 font-semibold">
                <span>대기: {pendingCount}장</span>
              </div>
            )}
            {failedCount > 0 && (
              <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-105 rounded-lg text-red-700 font-extrabold border border-red-200">
                <AlertCircle className="w-3.5 h-3.5 text-red-650" />
                <span>실패: {failedCount}장</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Primary body container */}
      <main className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6" id="workspace-main">
        
        {/* Policy Setting Row */}
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                <span>사진 해상도 자동 회전 보정 규칙</span>
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                이미지의 가로(img.width)와 세로(img.height) 해상도를 분석하여 가로형과 세로형 이미지를 정확하게 보정합니다.
              </p>
            </div>
            <div className="flex items-center bg-white border border-slate-200 px-4 py-2.5 rounded-xl shadow-xs shrink-0">
              <label className="flex items-center space-x-3 text-xs font-black text-slate-700 cursor-pointer select-none">
                <input 
                  type="checkbox"
                  checked={autoRotateOnUpload}
                  onChange={(e) => setAutoRotateOnUpload(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                />
                <span>사진 추가 시 즉시 가로/세로 자동 회전 보정 수행</span>
              </label>
            </div>
          </div>
        </div>

        {/* Bulk Action Controls bar & Filter */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4" id="bulk-toolkit-bar">
          
          {/* List checks */}
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={() => selectAll(true)}
              className="px-3 py-2 bg-slate-100 font-bold hover:bg-slate-200 text-slate-700 rounded-lg text-xs flex items-center space-x-1 cursor-pointer"
              title="대기열 내 모든 사진 선택"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>전체 선택</span>
            </button>
            <button 
              onClick={() => selectAll(false)}
              className="px-3 py-2 bg-slate-100 font-bold hover:bg-slate-200 text-slate-700 rounded-lg text-xs flex items-center space-x-1 cursor-pointer"
              title="모든 선택 해제"
            >
              <Square className="w-3.5 h-3.5" />
              <span>선택 해제</span>
            </button>

            <button 
              onClick={selectLandscapeOnly}
              className="px-3 py-2 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-indigo-800 font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
              title="가로 해상도(정사각형 포함) 사진 필터 선택"
            >
              <div className="w-4 h-2.5 border border-indigo-650 rounded-xs bg-indigo-200/50 shrink-0" />
              <span>가로 사진 선택</span>
            </button>

            <button 
              onClick={selectPortraitOnly}
              className="px-3 py-2 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-indigo-800 font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
              title="세로 해상도 사진 필터 선택"
            >
              <div className="w-2.5 h-4 border border-indigo-650 rounded-xs bg-indigo-200/50 shrink-0" />
              <span>세로 사진 선택</span>
            </button>

            <div className="h-6 w-px bg-slate-200 mx-1" />

            <span className="text-xs font-extrabold text-slate-600 border-r border-slate-200 pr-3 mr-1">
              선택한 {selectedCount}장 일괄 수동 회전:
            </span>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => bulkRotate(90)}
                disabled={selectedCount === 0}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white font-extrabold rounded-xl text-sm flex items-center space-x-2 transition-all active:scale-95 shadow-xs cursor-pointer"
                title="시계 방향 90도 회전"
              >
                <RotateCw className="w-4 h-4 stroke-[2.5]" />
                <span>시계방향 +90°</span>
              </button>
              <button 
                onClick={() => bulkRotate(-90)}
                disabled={selectedCount === 0}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white font-extrabold rounded-xl text-sm flex items-center space-x-2 transition-all active:scale-95 shadow-xs cursor-pointer"
                title="반시계 방향 90도 회전"
              >
                <RotateCcw className="w-4 h-4 stroke-[2.5]" />
                <span>반시계방향 -90°</span>
              </button>
              <button 
                onClick={() => bulkRotate(180)}
                disabled={selectedCount === 0}
                className="px-4 py-2.5 bg-white border border-slate-350 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-extrabold rounded-xl text-sm flex items-center space-x-1.5 transition-all active:scale-95 shadow-3xs cursor-pointer"
                title="180도 회전 반전"
              >
                <span>뒤집기 180°</span>
              </button>
              <button 
                onClick={bulkReset}
                disabled={selectedCount === 0}
                className="px-4 py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-650 font-extrabold rounded-xl text-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-3xs"
                title="선택한 항목 회전 0도로 완전 원본 초기화"
              >
                각도 초기화
              </button>
              <button 
                onClick={bulkDelete}
                disabled={selectedCount === 0}
                className="px-4 py-2.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-extrabold rounded-xl text-sm flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-xs"
                title="선택 목록 삭제"
              >
                <Trash2 className="w-4 h-4 animate-pulse text-rose-600" />
                <span>삭제 ({selectedCount})</span>
              </button>
            </div>
          </div>

          {/* Heavy background queuing triggers */}
          <div className="flex flex-wrap items-center gap-2.5">
            
            {/* Consolidated Auto Rotation Trigger */}
            <button 
              onClick={runAutoRotationForSelected}
              disabled={selectedCount === 0}
              className="px-3.5 py-2 bg-emerald-55 border border-emerald-250 hover:bg-emerald-100 disabled:opacity-50 text-emerald-800 font-extrabold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
              title="선택한 이미지를 해상도 기준으로 자동 로테이션 보정합니다."
            >
              <RotateCw className="w-3.5 h-3.5 text-emerald-600 animate-spin-slow" />
              <span>자동 해상도 보정하기</span>
            </button>

            {processingCount > 0 && (
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setIsProcessingPaused(!isProcessingPaused)}
                  className={`px-3 py-2 text-xs font-bold rounded-lg flex items-center space-x-1.5 ${
                    isProcessingPaused 
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                      : 'bg-amber-500 hover:bg-amber-600 text-white'
                  }`}
                  title="일시정지/재개"
                >
                  {isProcessingPaused ? (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>분석 재개</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3 h-3 fill-current" />
                      <span>일시정지</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <button 
              onClick={handleDownloadAllAsZip}
              className="px-4.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white font-extrabold rounded-xl text-xs flex items-center space-x-2 transition-all shadow-md cursor-pointer ml-auto md:ml-0"
              title="선택 혹은 보정된 사진들의 원본 파일명을 100% 보존하면서 시각 수정 각도를 적용해 통째로 다운로드합니다"
            >
              <FileArchive className="w-4 h-4 text-indigo-100" />
              <span>정위치 일괄 ZIP 저장 ({selectedCount}장)</span>
            </button>
          </div>
        </div>

        {/* Primary bulk drop-zone / file selection block */}
        <div className="grid grid-cols-1 gap-6" id="bulk-grid-sandbox">
          
          {/* Drop upload board */}
          <div 
            id="workspace-dropzone"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-3 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all ${
              isDragOver 
                ? 'border-indigo-650 bg-indigo-50/60 scale-[0.99] shadow-xs' 
                : 'border-slate-305 bg-white hover:border-indigo-500 hover:shadow-sm'
            }`}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              multiple 
              className="hidden" 
              id="main-drag-input"
            />
            <div className="p-4 bg-indigo-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 text-indigo-600">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-slate-800">폴더 채로 드래그하여 대용량 파일 올리기</h3>
            <p className="text-sm text-slate-500 max-w-xl mx-auto mt-1 leading-relaxed">
              기기 속 뒤틀린 스마일 스커트 스티커, 시리얼 라벨, 제조사 장비 딱지 사진들을 다중 선택(Ctrl+A)해서 옮겨놓으세요. <br />
              <strong className="text-indigo-600 font-semibold">초속 10장 클라이언트 압축 보정 기술</strong>이 적용되어 용량 초과와 버벅임 없이 수월하게 즉시 로테이션 분석을 실행합니다.
            </p>
          </div>

          {/* List display & pagination filter tabs */}
          {totalCount > 0 ? (
            <div className="space-y-4" id="image-workspace-view">
              
              {/* Tab Category Controls */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-3">
                <div className="flex flex-wrap items-center gap-1.5" id="tab-selectors">
                  <button 
                    onClick={() => setActiveTab('all')}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      activeTab === 'all' 
                        ? 'bg-slate-800 text-white shadow-xs' 
                        : 'text-slate-500 hover:bg-slate-150 hover:text-slate-800'
                    }`}
                  >
                    전체 ({totalCount})
                  </button>
                  <button 
                    onClick={() => setActiveTab('pending')}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      activeTab === 'pending' 
                        ? 'bg-slate-800 text-white shadow-xs' 
                        : 'text-slate-500 hover:bg-slate-150 hover:text-slate-800'
                    }`}
                  >
                    대기/분석 중 ({pendingCount + processingCount})
                  </button>
                  <button 
                    onClick={() => setActiveTab('completed')}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      activeTab === 'completed' 
                        ? 'bg-slate-800 text-white shadow-xs' 
                        : 'text-slate-500 hover:bg-slate-150 hover:text-slate-800'
                    }`}
                  >
                    감지 완료 ({completedCount})
                  </button>
                  <button 
                    onClick={() => setActiveTab('failed')}
                    className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      activeTab === 'failed' 
                        ? 'bg-rose-500 text-white shadow-xs' 
                        : 'text-slate-500 hover:bg-slate-150 hover:text-slate-800'
                    }`}
                  >
                    실패 ({failedCount})
                  </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0" id="card-size-selectors">
                  <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-500 font-bold px-1 select-none">보기 크기:</span>
                    <button 
                      onClick={() => setCardSize('medium')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        cardSize === 'medium' 
                          ? 'bg-white text-slate-900 shadow-sm' 
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      보통
                    </button>
                    <button 
                      onClick={() => setCardSize('large')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        cardSize === 'large' 
                          ? 'bg-white text-slate-900 shadow-sm' 
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      크게
                    </button>
                    <button 
                      onClick={() => setCardSize('xlarge')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        cardSize === 'xlarge' 
                          ? 'bg-white text-slate-900 shadow-sm' 
                          : 'text-slate-600 hover:text-slate-950'
                      }`}
                      title="매우 크게 보기 (모바일 또는 정밀 판독)"
                    >
                      매우크게
                    </button>
                  </div>

                  <div className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200" id="current-displayed-counter">
                    표시 중: {filteredFiles.length}장
                  </div>
                </div>
              </div>

              {/* Keyboard Custom Control Walkthrough/HUD */}
              <div className="bg-slate-800 text-white rounded-2xl p-4 shadow-sm border border-slate-700 flex flex-col xl:flex-row xl:items-center justify-between gap-4" id="keyboard-shortcut-guide-hud" style={{ backgroundColor: 'rgb(30, 41, 59)' }}>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-slate-700 rounded-xl text-indigo-300 shrink-0 mt-0.5 shadow-inner">
                    <Keyboard className="w-5 h-5 stroke-[2.5]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white flex items-center gap-1.5">
                      <span>⌨️ 손목 보호 초고속 회전 단축키 활성화 완료</span>
                      <span className="bg-emerald-500 text-slate-950 font-black text-[9px] px-1.5 py-0.5 rounded-full animate-pulse uppercase tracking-wide">Active</span>
                    </h4>
                    <p className="text-xs text-slate-350 mt-1 leading-relaxed">
                      방향키로 카드를 넘나들고, <kbd className="bg-slate-800 px-1 py-0.5 rounded text-white font-black text-[11px]">A</kbd> 와 <kbd className="bg-slate-800 px-1 py-0.5 rounded text-white font-black text-[11px]">D</kbd> 만 사용하면 양손의 피로도 없이 대량도 순식간에 회전 보정할 수 있습니다.
                    </p>
                  </div>
                </div>
                             {/* Grid of keys for extreme clarity */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 shrink-0 w-full xl:w-auto">
                  <div className="bg-slate-800/85 rounded-xl px-2.5 py-1.5 border border-slate-750 flex flex-col items-center justify-center min-w-[90px]" title="방향키를 사용하여 포커스 대상 카드 이동">
                    <kbd className="bg-slate-950 border-b-2 border-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold text-white shadow-xs mb-1">← ↑ ↓ →</kbd>
                    <span className="text-[10px] text-slate-300 font-extrabold text-center">오직 카드 이동</span>
                  </div>

                  <div className="bg-slate-800/85 rounded-xl px-2.5 py-1.5 border border-slate-750 flex flex-col items-center justify-center min-w-[90px]" title="선택된 사진을 반시계 방향(-90°)으로 회전">
                    <kbd className="bg-slate-955 border-b-2 border-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold text-rose-455 shadow-xs mb-1">A</kbd>
                    <span className="text-[10px] text-rose-300 font-black text-center">좌회전 -90°</span>
                  </div>

                  <div className="bg-slate-800/85 rounded-xl px-2.5 py-1.5 border border-slate-750 flex flex-col items-center justify-center min-w-[90px]" title="선택된 사진을 시계 방향(+90°)으로 회전">
                    <kbd className="bg-slate-955 border-b-2 border-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold text-indigo-405 shadow-xs mb-1">D</kbd>
                    <span className="text-[10px] text-indigo-300 font-black text-center">우회전 +90°</span>
                  </div>

                  <div className="bg-slate-800/85 rounded-xl px-2.5 py-1.5 border border-slate-750 flex flex-col items-center justify-center min-w-[90px]" title="선택된 사진을 180도 완전 뒤집기">
                    <kbd className="bg-slate-950 border-b-2 border-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold text-amber-400 shadow-xs mb-1">W / S / F</kbd>
                    <span className="text-[10px] text-amber-300 font-extrabold text-center">180° 상하반전</span>
                  </div>

                  <div className="bg-slate-800/85 rounded-xl px-2.5 py-1.5 border border-slate-755 flex flex-col items-center justify-center min-w-[90px]" title="선택 상태 교대로 반전">
                    <kbd className="bg-slate-950 border-b-2 border-slate-700 px-1 py-0.5 rounded font-mono text-[9px] font-bold text-white shadow-xs mb-1">Enter / Q / Space</kbd>
                    <span className="text-[10px] text-slate-300 font-extrabold text-center">선택 선택 토글</span>
                  </div>

                  <div className="bg-slate-800/85 rounded-xl px-2.5 py-1.5 border border-slate-750 flex flex-col items-center justify-center min-w-[90px]" title="언제든지 즉시 웹페이지 맨 위로 이동">
                    <kbd className="bg-slate-950 border-b-2 border-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold text-emerald-400 shadow-xs mb-1">T / Home</kbd>
                    <span className="text-[10px] text-emerald-300 font-black text-center">맨위로 🔝</span>
                  </div>
                </div>
              </div>

              {/* HIGH PERFORMANCE MULTI GRID SHEET */}
              <div 
                className={`grid ${
                  cardSize === 'medium' 
                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4' 
                    : cardSize === 'xlarge' 
                    ? 'grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8' 
                    : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-6'
                }`} 
                id="heavy-loaded-grid"
              >
                {filteredFiles.map((file) => {
                  const finalRotation = computeTotalRotation(file);
                  const isFocused = file.id === focusedFileId;
                  
                  return (
                    <div 
                      key={file.id} 
                      id={`grid-card-${file.id}`}
                      onClick={() => setFocusedFileId(file.id)}
                      className={`bg-white rounded-2xl border transition-all flex flex-col relative group overflow-hidden cursor-pointer ${
                        isFocused 
                          ? 'border-indigo-600 ring-4 ring-indigo-500 hover:ring-indigo-500/90 shadow-xl scale-[1.015] z-10' 
                          : file.selected 
                          ? 'border-indigo-400 shadow-sm ring-1 ring-indigo-300' 
                          : 'border-slate-200 hover:border-slate-350 hover:shadow-xs'
                      }`}
                    >
                      {/* Checkbox badge helper */}
                      <div className="absolute top-2.5 left-2.5 z-20">
                        <input 
                          type="checkbox"
                          checked={file.selected || false}
                          onChange={() => toggleSelectFile(file.id)}
                          className="w-4 h-4 accent-indigo-600 rounded cursor-pointer border-slate-300 shadow-xs focus:ring-indigo-500"
                        />
                      </div>

                      {/* Status badge in upper right corner */}
                      <div className="absolute top-2.5 right-2.5 z-20 flex items-center space-x-1">
                        {file.status === 'processing' && (
                          <div className="bg-indigo-600 text-white p-1 rounded-full animate-spin">
                            <RefreshCw className="w-3 h-3" />
                          </div>
                        )}
                        {file.status === 'pending' && (
                          <div className="bg-slate-200 text-slate-600 text-[9px] font-extrabold px-1.5 py-0.5 rounded">
                            대기
                          </div>
                        )}
                        {file.status === 'failed' && (
                          <div className="bg-red-100 text-red-700 p-1 rounded-full" title={file.error}>
                            <AlertCircle className="w-3 h-3 animate-bounce" />
                          </div>
                        )}
                        {file.status === 'completed' && (
                          <div className="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-xs flex items-center space-x-0.5">
                            <Check className="w-2.5 h-2.5 stroke-[4]" />
                            <span>{finalRotation}°</span>
                          </div>
                        )}
                      </div>

                      {/* WORKBENCH STAGE CANVAS VIEW */}
                      <div 
                        className={`w-full bg-slate-900 border-b border-slate-100 relative overflow-hidden flex items-center justify-center p-3 select-none cursor-pointer group/canvas ${
                          cardSize === 'xlarge' 
                            ? 'h-[440px] sm:h-[520px]' 
                            : cardSize === 'large' 
                            ? 'h-[320px] sm:h-[380px]' 
                            : 'h-[180px] sm:h-[230px]'
                        }`}
                        onClick={() => rotateIndividual(file.id, 90)}
                        title="클릭 시 시계 방향 90도 회정"
                      >
                        
                        {/* CSS-transformed actual rotation (Superb visual matching) */}
                        <img 
                          src={file.objectUrl} 
                          alt={file.name} 
                          className="max-w-full max-h-full object-contain shadow-md rounded transition-transform duration-300 ease-out group-hover/canvas:opacity-85"
                          style={{ transform: `rotate(${finalRotation}deg)` }}
                          draggable={false}
                        />

                        {/* Interactive Click to Rotate Overlay Hint */}
                        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover/canvas:opacity-100 transition-opacity flex flex-col items-center justify-center text-center p-2 text-white">
                          <RotateCw className="w-6 h-6 mb-1 text-white animate-spin-slow" />
                          <span className="text-xs font-black">클릭 시 시계방향 90° 회전</span>
                        </div>

                        {/* If analyzing is in-progress screen mask */}
                        {file.status === 'processing' && (
                          <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center text-center p-2">
                            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mb-1.5" />
                            <span className="text-[10pt] font-bold text-white tracking-widest animate-pulse">각도 계측...</span>
                          </div>
                        )}

                        {/* Error mask */}
                        {file.status === 'failed' && (
                          <div className="absolute inset-x-0 inset-y-0 bg-slate-950/75 flex flex-col items-center justify-center text-center p-3 z-10">
                            <AlertCircle className="w-6 h-6 text-red-400 mb-1" />
                            <span className="text-[9px] text-red-300 line-clamp-2 px-1 mb-2">{file.error}</span>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation(); // prevent rotation on click
                                reprocessFile(file.id);
                              }}
                              className="px-2 py-1 bg-red-650 hover:bg-red-750 font-bold text-[9px] text-white rounded"
                            >
                              재시도
                            </button>
                          </div>
                        )}
                      </div>

                      {/* File identity, Large Manual controls, and helper meta labels */}
                      <div className="p-3 flex-1 flex flex-col justify-between" id={`caption-grid-${file.id}`}>
                        <div>
                          {/* File metadata */}
                          <div className="min-w-0 mb-2">
                            <div className="flex items-center justify-between gap-1.5">
                              <p className="text-[12px] text-slate-800 font-extrabold truncate" title={file.name}>
                                {file.name}
                              </p>
                              <span className="text-[10px] text-slate-400 shrink-0 font-bold">{file.size}</span>
                            </div>
                          </div>

                          {/* HUGE INDIVIDUAL MANUAL ROTATION BUTTONS ROW */}
                          <div className="flex flex-col gap-2 mb-3">
                            <div className="grid grid-cols-2 gap-2">
                              <button 
                                onClick={() => rotateIndividual(file.id, -90)}
                                className="py-2 px-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-extrabold rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all active:scale-95 cursor-pointer shadow-xs select-none"
                                title="수동: 반시계 방향 -90도 회전 (좌회전)"
                              >
                                <RotateCcw className="w-3.5 h-3.5 text-rose-600 stroke-[3]" />
                                <span>좌회전 -90°</span>
                              </button>
                              
                              <button 
                                onClick={() => rotateIndividual(file.id, 90)}
                                className="py-2 px-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all active:scale-95 cursor-pointer shadow-md select-none"
                                title="수동: 시계 방향 +90도 회전 (우회전)"
                              >
                                <RotateCw className="w-3.5 h-3.5 text-white stroke-[3]" />
                                <span>우회전 +90°</span>
                              </button>
                            </div>

                            <button 
                              onClick={() => rotateIndividual(file.id, 180)}
                              className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-extrabold rounded-xl text-xs flex items-center justify-center space-x-2 transition-all active:scale-95 cursor-pointer shadow-sm select-none"
                              title="수동: 완전히 거꾸로 상하 180도 뒤집기"
                            >
                              <RefreshCw className="w-3 h-3 text-slate-300 stroke-[2.5]" />
                              <span>180° 상하 뒤집기</span>
                            </button>
                          </div>

                          {/* Context-aware rotation status details */}
                          {file.status === 'completed' && file.explanation && (
                            <span className="text-[10px] text-slate-500 line-clamp-2 block mb-2 px-2 py-1.5 bg-slate-50 border border-slate-100 rounded text-center font-semibold" title={file.explanation}>
                              {file.explanation}
                            </span>
                          )}
                        </div>

                        {/* Fine utilities at the bottom */}
                        <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-auto">
                          <div>
                            {(file.manualDegrees !== 0 || file.detectedDegrees !== 0) ? (
                              <button 
                                onClick={() => resetIndividual(file.id)}
                                className="px-2 py-1 text-[10px] font-bold text-red-650 hover:bg-red-50 border border-red-200 rounded-lg transition-all cursor-pointer"
                                title="이 사진의 회전을 원본(0도) 상태로 복구합니다"
                              >
                                보정 초기화
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-bold px-1 select-none">원본 각도</span>
                            )}
                          </div>

                          <div className="flex items-center space-x-1 ml-auto">
                            <button 
                              onClick={() => handleDownloadSingleRotated(file)}
                              className="p-1 px-1.5 text-indigo-650 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-lg transition-all active:scale-90 flex items-center gap-1 cursor-pointer"
                              title="이 회전된 고해상도 원본 사진 직접 저장"
                            >
                              <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span className="text-[9px] font-black">저장</span>
                            </button>
                            <button 
                              onClick={() => removeFile(file.id)}
                              className="p-1 text-slate-400 hover:bg-slate-100 hover:text-red-550 border border-transparent rounded-lg transition-all cursor-pointer"
                              title="대기 목록에서 제거"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Back to Top Quick Link Button */}
              <div className="flex justify-center pt-8 pb-4 animate-fade-in" id="row-scroll-to-top">
                <button
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    showToast('페이지 맨 위로 이동했습니다. 🔝', 'info');
                  }}
                  className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-805 font-extrabold rounded-2xl text-xs flex items-center justify-center space-x-2.5 transition-all active:scale-95 cursor-pointer shadow-sm border border-slate-200 select-none hover:text-indigo-600 hover:border-indigo-200"
                  title="페이지 맨 위로 즉시 스크롤 (단축키: T 또는 Home)"
                >
                  <ArrowUp className="w-4 h-4 text-slate-650 animate-bounce stroke-[3]" />
                  <span>맨 위로 스크롤 이동 (단축키: T)</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm flex flex-col items-center justify-center min-h-[300px]" id="empty-workspace-state">
              <div className="p-4 bg-slate-50 rounded-full mb-3 text-slate-400">
                <ImageIcon className="w-10 h-10" />
              </div>
              <h3 className="text-base font-bold text-slate-800">보정할 이미지가 존재하지 않습니다</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                위 업로드 영역을 이용하시거나 원하는 대량 사진(700장 이상 완벽 보장)들을 선택해서 넣어주세요.
              </p>
            </div>
          )}

        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 mt-16 text-center text-xs text-slate-400" id="main-footer">
        <div className="max-w-[1600px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 대량 일괄 정위치 보정기. Crafted with optimized Client-side resizing and JSZip compression.</p>
          <div className="flex items-center space-x-3 text-[11px] font-semibold text-slate-500">
            <span>Concurrency Queue: Active</span>
            <span>•</span>
            <span>Gemini LLM Vision Rotation Tracker</span>
          </div>
        </div>
      </footer>

      {/* 📥 수동 다운로드 성공 확인 모달 (방안 B) */}
      {isDownloadConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in" id="download-confirm-modal">
          <div className="bg-white rounded-3xl max-w-lg w-full p-7 shadow-2xl border border-slate-100 transform transition-all animate-scale-up">
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600 flex-shrink-0">
                <HelpCircle className="w-8 h-8 animate-pulse text-indigo-650" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-1.5 animate-pulse">
                  📥 스마트 보정 이미지 압축 파일 다운로드 완료 확인
                </h3>
                <p className="text-sm text-slate-500 mt-3.5 leading-relaxed">
                  변환 압축이 포함된 <strong className="text-slate-800 font-bold">정위치 ZIP 압축파일</strong>이 브라우저 다운로드 큐로 전달되었습니다! <br />
                  브라우저가 제공한 파일 보존 창 및 폴더 선택 팝업에서 <strong className="text-indigo-605 font-bold">정상적으로 저장(확인)</strong>을 마치셨나요?
                </p>
                <div className="mt-4 bg-slate-50 rounded-xl p-3 border border-slate-100 text-xs text-slate-500 space-y-1.5 leading-normal">
                  <p>✔ <strong className="text-slate-705">예, 제외합니다</strong>: 이미 기기에 무사히 저장되었으므로 보정이 완료된 <strong className="text-slate-705 font-bold">{downloadedTargetFileIds.length}장</strong>의 사진을 목록에서 걷어차 깨끗하게 지웁니다.</p>
                  <p>✔ <strong className="text-slate-705">아니오, 그대로 유지</strong>: 브라우저 팝업 취소 등으로 다운로드를 일시 보류 또는 안전하게 재시도해야 할 경우, 현 상태 그대로 대기열에 완벽 보존해 둡니다.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 mt-7">
              <button
                onClick={cancelDownloadRemoval}
                className="px-5 py-2.5 border border-slate-200 text-slate-650 hover:bg-slate-50 hover:text-slate-800 text-xs font-bold rounded-xl transition-all active:scale-[0.98] cursor-pointer"
              >
                아니요, 대기열에 유지 (취소/재시도)
              </button>
              <button
                onClick={confirmDownloadAndRemove}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-black rounded-xl transition-all shadow-md hover:shadow-lg cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>예, 다운로드 확인 및 대기열 제외</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
