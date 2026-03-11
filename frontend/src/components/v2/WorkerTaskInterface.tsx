import React, { useState, useEffect } from 'react';
import {
    LayoutDashboard,
    Timer,
    ArrowRight,
    ScanLine,
    MousePointer2,
    Hexagon,
    Brush,
    SkipBack,
    Play,
    SkipForward,
    Mic,
    Loader2,
    Zap,
    Clock,
    Users,
    Info,
    Trash2,
    XCircle,
    X,
    Maximize2,
    ArrowLeft,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

export interface TaskData {
    id: string;
    type: 'vision' | 'nlp' | 'audio' | 'form';
    title: string;
    subtitle?: string;
    reward?: string;
    verificationType?: string;
    imageUrl?: string;
    textContent?: string;
    audioUrl?: string;
    formData?: any;
}

export interface TaskConfig {
    instruction: string;
    tools?: ('draw' | 'select' | 'poly' | 'brush')[];
    classes?: { id: string | number; name: string; color?: string }[];
    hasTranscribeInput?: boolean;
    hasRecordInput?: boolean;
    hasTranslationInput?: boolean;
    exampleImageUrl?: string;
    entityTags?: string[];
}

export interface WorkerTaskInterfaceProps {
    task: TaskData;
    config: TaskConfig;
    onSubmit: (result: any) => Promise<void> | void;
    onExit: () => void;
}

export const WorkerTaskInterface: React.FC<WorkerTaskInterfaceProps> = ({
    task,
    config,
    onSubmit,
    onExit
}) => {
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [selectedClassId, setSelectedClassId] = useState<string | number | null>(null);
    const [showInstructions, setShowInstructions] = useState(false);
    const [showClasses, setShowClasses] = useState(true);

    // NER State
    const [nerAnnotations, setNerAnnotations] = useState<{ start: number, end: number, text: string, tag: string, color: string }[]>([]);
    const [activeNerTag, setActiveNerTag] = useState<string | null>(null);

    const getTagColor = (tag: string) => {
        let hash = 0;
        for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
        const hue = Math.abs(hash % 360);
        return `hsl(${hue}, 70%, 85%)`;
    };

    const handleNerSelection = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        const container = document.getElementById('ner-text-container');
        if (!container || !container.contains(selection.anchorNode)) return;
        if (!activeNerTag) { alert("Please select a tag first."); return; }
        const range = selection.getRangeAt(0);
        const getCleanOffset = (node: Node, offset: number): number => {
            try {
                const preRange = document.createRange();
                preRange.selectNodeContents(container);
                preRange.setEnd(node, offset);
                const fragment = preRange.cloneContents();
                const tempDiv = document.createElement('div');
                tempDiv.appendChild(fragment);
                const ignored = tempDiv.querySelectorAll('[data-ignore-ner="true"]');
                ignored.forEach(el => el.remove());
                return tempDiv.textContent?.length || 0;
            } catch (e) { return -1; }
        };
        const start = getCleanOffset(range.startContainer, range.startOffset);
        const end = getCleanOffset(range.endContainer, range.endOffset);
        if (start === -1 || end === -1 || start >= end) return;
        const realText = displayedText.slice(start, end);
        const newAnnotations = nerAnnotations.filter(a => (start >= a.end || end <= a.start));
        newAnnotations.push({ start, end, text: realText, tag: activeNerTag, color: getTagColor(activeNerTag) });
        newAnnotations.sort((a, b) => a.start - b.start);
        setNerAnnotations(newAnnotations);
        selection.removeAllRanges();
    };

    const renderHighlightedText = (fullText: string) => {
        if (nerAnnotations.length === 0) return fullText;
        const segments = [];
        let lastIndex = 0;
        nerAnnotations.forEach((ann, i) => {
            if (ann.start > lastIndex) {
                const slice = fullText.slice(lastIndex, ann.start);
                if (slice) segments.push(<span key={`text-${i}`}>{slice}</span>);
            }
            segments.push(
                <mark key={`mark-${i}`} className="relative cursor-pointer group" style={{ backgroundColor: ann.color, padding: '2px 0' }}>
                    {fullText.slice(ann.start, ann.end)}
                    <span data-ignore-ner="true" className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gray-900 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 select-none pointer-events-none">{ann.tag}</span>
                    <button data-ignore-ner="true" className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 hover:bg-red-600 transition z-20 select-none"
                        onClick={(e) => { e.stopPropagation(); setNerAnnotations(prev => prev.filter((_, idx) => idx !== i)); }}>×</button>
                </mark>
            );
            lastIndex = ann.end;
        });
        if (lastIndex < fullText.length) segments.push(<span key="text-end">{fullText.slice(lastIndex)}</span>);
        return segments;
    };

    useEffect(() => {
        const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    const formatTime = (totalSeconds: number) => {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const [surveyAnswers, setSurveyAnswers] = useState<Record<number, any>>({});
    const handleSurveyChange = (index: number, value: any) => {
        setSurveyAnswers(prev => ({ ...prev, [index]: value }));
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        let finalOutputText = textInput.trim();
        if (task.type === 'form') finalOutputText = JSON.stringify(surveyAnswers);
        const result = {
            taskId: task.id,
            duration: elapsedSeconds,
            output: {
                text: finalOutputText,
                classification: selectedClassId,
                formData: task.type === 'form' ? surveyAnswers : undefined,
                ner: nerAnnotations,
                boxes: boxes,
                polygons: polygons
            }
        };
        try {
            await onSubmit(result);
            setTextInput('');
            setSelectedClassId(null);
            setElapsedSeconds(0);
        } catch (e) { console.error(e); }
        finally { setIsSubmitting(false); }
    };

    const [expandedImage, setExpandedImage] = useState<string | null>(null);

    // Drawing state
    const [boxes, setBoxes] = useState<{ id: number, x: number, y: number, w: number, h: number, color: string, classId: string | number, label: string }[]>([]);
    const [polygons, setPolygons] = useState<{ id: number, points: { x: number, y: number }[], color: string, label: string }[]>([]);
    const [currentPoly, setCurrentPoly] = useState<{ points: { x: number, y: number }[] } | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [currentBox, setCurrentBox] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
    const [selectedPolyId, setSelectedPolyId] = useState<number | null>(null);

    const cancelAction = () => { setIsDrawing(false); setStartPos({ x: 0, y: 0 }); setCurrentBox(null); setCurrentPoly(null); setSelectedBoxId(null); setSelectedPolyId(null); };
    const deleteSelected = () => {
        if (selectedBoxId !== null) { setBoxes(prev => prev.filter(b => b.id !== selectedBoxId)); setSelectedBoxId(null); }
        if (selectedPolyId !== null) { setPolygons(prev => prev.filter(p => p.id !== selectedPolyId)); setSelectedPolyId(null); }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
            if (e.key === 'Escape') cancelAction();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedBoxId, selectedPolyId, isDrawing, currentPoly]);

    const getMouseCoords = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const scaleX = 800 / rect.width;
        const scaleY = 600 / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (config.tools?.includes('poly')) {
            const { x, y } = getMouseCoords(e);
            if (currentPoly && currentPoly.points.length > 2) {
                const start = currentPoly.points[0];
                const dist = Math.sqrt(Math.pow(x - start.x, 2) + Math.pow(y - start.y, 2));
                if (dist < 20) {
                    const activeClass = config.classes?.find(c => c.id === selectedClassId);
                    setPolygons([...polygons, { id: Date.now(), points: currentPoly.points, color: activeClass?.color || '#3b82f6', label: activeClass?.name || 'Region' }]);
                    setCurrentPoly(null);
                    return;
                }
            }
            if (!currentPoly) setCurrentPoly({ points: [{ x, y }] });
            else setCurrentPoly({ points: [...currentPoly.points, { x, y }] });
            return;
        }
        if (!config.tools?.includes('draw')) return;
        if (e.target === e.currentTarget) setSelectedBoxId(null);
        const { x, y } = getMouseCoords(e);
        setStartPos({ x, y });
        setIsDrawing(true);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const { x, y } = getMouseCoords(e);
        setMousePos({ x, y });
        if (isDrawing && config.tools?.includes('draw')) {
            setCurrentBox({ x: Math.min(x, startPos.x), y: Math.min(y, startPos.y), w: Math.abs(x - startPos.x), h: Math.abs(y - startPos.y) });
        }
    };

    const handleMouseUp = () => {
        if (!isDrawing || !currentBox) { setIsDrawing(false); return; }
        if (currentBox.w > 5 && currentBox.h > 5) {
            const activeClass = config.classes?.find(c => c.id === selectedClassId);
            const newBox = { ...currentBox, id: Date.now(), color: activeClass?.color || '#facc15', classId: activeClass?.id || 'unknown', label: activeClass?.name || 'Object' };
            setBoxes([...boxes, newBox]);
            setSelectedBoxId(newBox.id);
        }
        setIsDrawing(false);
        setCurrentBox(null);
    };

    const deleteBox = (id: number) => { setBoxes(boxes.filter(b => b.id !== id)); if (selectedBoxId === id) setSelectedBoxId(null); };
    const deletePoly = (id: number) => { setPolygons(polygons.filter(p => p.id !== id)); if (selectedPolyId === id) setSelectedPolyId(null); };

    const [displayedText, setDisplayedText] = useState<string>(task.textContent || "No text content provided.");
    useEffect(() => {
        const content = task.textContent;
        if (content && (content.startsWith('http') || content.startsWith('/'))) {
            setDisplayedText("Loading text content...");
            fetch(content).then(res => res.text()).then(text => setDisplayedText(text)).catch(() => setDisplayedText("Error loading text content."));
        } else {
            setDisplayedText(content || "No text content provided.");
        }
    }, [task.textContent]);

    const renderVision = () => (
        <div
            className="relative shadow-2xl rounded-sm border border-gray-700 select-none bg-gray-900 overflow-hidden cursor-crosshair w-full max-w-[800px] aspect-[4/3]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            tabIndex={0}
        >
            <div className="absolute inset-0 pointer-events-none opacity-20"
                style={{ backgroundImage: 'linear-gradient(45deg, #1f2937 25%, transparent 25%), linear-gradient(-45deg, #1f2937 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1f2937 75%), linear-gradient(-45deg, transparent 75%, #1f2937 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px' }} />
            {task.imageUrl && <img src={task.imageUrl} className="w-full h-full object-contain pointer-events-none relative z-10 opacity-80" alt="Task Subject" />}
            <svg className="absolute inset-0 w-full h-full z-20 pointer-events-none" viewBox="0 0 800 600" preserveAspectRatio="none">
                {polygons.map(poly => (
                    <g key={poly.id} onClick={(e) => { e.stopPropagation(); setSelectedPolyId(poly.id); }} className="pointer-events-auto cursor-pointer">
                        <polygon points={poly.points.map(p => `${p.x},${p.y}`).join(' ')} fill={poly.color} fillOpacity={selectedPolyId === poly.id ? 0.6 : 0.4} stroke={poly.color} strokeWidth={selectedPolyId === poly.id ? 3 : 1} />
                        <text x={poly.points.reduce((sum, p) => sum + p.x, 0) / poly.points.length} y={poly.points.reduce((sum, p) => sum + p.y, 0) / poly.points.length} fill="white" fontSize="12" fontWeight="bold" textAnchor="middle">{poly.label}</text>
                    </g>
                ))}
                {currentPoly && (
                    <g>
                        <polyline points={currentPoly.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4" />
                        {currentPoly.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 5 : 3} fill={i === 0 ? 'white' : '#3b82f6'} stroke="#3b82f6" strokeWidth="1" />)}
                        {mousePos && currentPoly.points.length > 0 && <line x1={currentPoly.points[currentPoly.points.length - 1].x} y1={currentPoly.points[currentPoly.points.length - 1].y} x2={mousePos.x} y2={mousePos.y} stroke="#3b82f6" strokeWidth="1" strokeDasharray="2" />}
                    </g>
                )}
            </svg>
            {boxes.map(box => (
                <div key={box.id}
                    className={`absolute border-2 z-30 transition-all ${selectedBoxId === box.id ? 'border-white ring-2 ring-white/50 z-40' : ''}`}
                    style={{ left: `${(box.x / 800) * 100}%`, top: `${(box.y / 600) * 100}%`, width: `${(box.w / 800) * 100}%`, height: `${(box.h / 600) * 100}%`, borderColor: box.color, backgroundColor: `${box.color}20` }}
                    onMouseDown={(e) => { e.stopPropagation(); setSelectedBoxId(box.id); }}>
                    <div className="absolute -top-6 left-0 px-2 py-0.5 text-[10px] font-bold text-white rounded shadow-sm whitespace-nowrap" style={{ backgroundColor: box.color }}>
                        {box.label}
                        {selectedBoxId === box.id && <span className="ml-2 cursor-pointer hover:text-red-200" onClick={(e) => { e.stopPropagation(); deleteBox(box.id); }}>✕</span>}
                    </div>
                </div>
            ))}
            {currentBox && (
                <div className="absolute border-2 border-dashed border-white z-50 pointer-events-none"
                    style={{ left: `${(currentBox.x / 800) * 100}%`, top: `${(currentBox.y / 600) * 100}%`, width: `${(currentBox.w / 800) * 100}%`, height: `${(currentBox.h / 600) * 100}%` }} />
            )}
        </div>
    );

    const renderNLP = () => (
        <div className="w-full max-w-3xl bg-white rounded-lg shadow-xl text-gray-900 overflow-hidden flex flex-col">
            <div className="bg-gray-100 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="font-bold text-gray-700 text-sm md:text-base">
                    {config.entityTags ? 'Named Entity Recognition' : 'Source Text'}
                </h3>
                <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded">ID: {task.id}</span>
            </div>
            {config.entityTags && config.entityTags.length > 0 && (
                <div className="px-4 md:px-6 py-3 bg-white border-b border-gray-100 flex gap-2 flex-wrap items-center">
                    <span className="text-xs font-bold text-gray-400 uppercase mr-2">Tags:</span>
                    {config.entityTags.map(tag => (
                        <button key={tag} onClick={() => setActiveNerTag(tag)}
                            className={`px-2 md:px-3 py-1 md:py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 border ${activeNerTag === tag ? 'ring-2 ring-offset-1 ring-blue-500 shadow-sm' : 'hover:bg-gray-50 border-gray-200 text-gray-600'}`}
                            style={{ backgroundColor: activeNerTag === tag ? getTagColor(tag) : undefined, borderColor: activeNerTag === tag ? 'transparent' : undefined, color: activeNerTag === tag ? '#1f2937' : undefined }}>
                            <span className="w-2 h-2 rounded-full bg-current opacity-50" />{tag}
                        </button>
                    ))}
                </div>
            )}
            <div className="p-4 md:p-8 text-base md:text-lg leading-relaxed font-serif whitespace-pre-wrap flex-1">
                {config.entityTags ? (
                    <div id="ner-text-container" onMouseUp={handleNerSelection} className="prose max-w-none text-gray-800 text-sm md:text-base">
                        {renderHighlightedText(displayedText)}
                    </div>
                ) : displayedText}
            </div>
            {!config.entityTags && config.classes && config.classes.length > 0 && (
                <div className="border-t border-gray-200 p-4 md:p-6 bg-gray-50">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-3">Classification</label>
                    <div className="flex flex-wrap gap-2 md:gap-3">
                        {config.classes.map((cls) => (
                            <button key={cls.id} onClick={() => setSelectedClassId(cls.id)}
                                className={`px-3 md:px-4 py-2 rounded-lg border text-xs md:text-sm font-semibold transition ${selectedClassId === cls.id ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                                {cls.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {config.hasTranslationInput && (
                <div className="border-t border-gray-200 p-4 md:p-6 bg-gray-50">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Translation</label>
                    <textarea className="w-full border border-gray-300 rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={3} placeholder="Type translation here..." value={textInput} onChange={(e) => setTextInput(e.target.value)} />
                </div>
            )}
        </div>
    );

    const renderAudio = () => (
        <div className="w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-xl p-6 md:p-8 flex flex-col gap-5 md:gap-6">
            <div className="h-24 md:h-32 bg-gray-950 rounded-lg border border-gray-800 flex items-center justify-center relative overflow-hidden">
                <div className="flex gap-1 items-center justify-center w-full px-6 h-14">
                    {Array.from({ length: 40 }).map((_, i) => (
                        <div key={i} className="bg-blue-500 rounded-sm w-1 animate-pulse" style={{ height: `${Math.max(20, Math.random() * 100)}%`, animationDelay: `${i * 0.05}s` }} />
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-3 md:gap-4 justify-center">
                <button className="p-2.5 md:p-3 bg-gray-800 rounded-full hover:bg-gray-700 text-white"><SkipBack className="w-4 h-4 md:w-5 md:h-5" /></button>
                <button className="p-3 md:p-4 bg-white rounded-full hover:bg-gray-200 text-black shadow-lg"><Play className="w-5 h-5 md:w-6 md:h-6 fill-black" /></button>
                <button className="p-2.5 md:p-3 bg-gray-800 rounded-full hover:bg-gray-700 text-white"><SkipForward className="w-4 h-4 md:w-5 md:h-5" /></button>
            </div>
            {config.hasTranscribeInput && (
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Transcription</label>
                    <textarea className="w-full bg-gray-800 border border-gray-700 rounded p-3 md:p-4 text-gray-200 focus:border-blue-500 outline-none font-mono text-sm" rows={4} placeholder="Type what you hear..." value={textInput} onChange={(e) => setTextInput(e.target.value)} />
                </div>
            )}
            {config.hasRecordInput && (
                <div className="text-center p-5 md:p-6 border-2 border-dashed border-gray-700 rounded-lg hover:border-red-500 cursor-pointer transition group">
                    <div className="w-14 h-14 md:w-16 md:h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-red-900/50 group-hover:scale-110 transition">
                        <Mic className="w-7 h-7 md:w-8 md:h-8 text-white" />
                    </div>
                    <p className="font-bold text-white text-sm md:text-base">Click to Record</p>
                </div>
            )}
        </div>
    );

    const renderForm = () => {
        const questions = task.formData as { question: string; type: 'text' | 'multiple_choice' | 'checkbox' | 'rating'; required: boolean; options?: string[]; }[] || [];
        if (questions.length === 0) {
            return (
                <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl p-6 md:p-8 text-gray-900 flex flex-col items-center justify-center min-h-[200px]">
                    <p className="text-gray-400 italic text-sm">No questions found for this survey.</p>
                </div>
            );
        }
        return (
            <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden text-gray-900 flex flex-col">
                <div className="bg-gray-100 px-5 md:px-8 py-4 md:py-6 border-b border-gray-200">
                    <h2 className="text-lg md:text-2xl font-bold text-gray-800">{task.title || 'Survey Task'}</h2>
                    <p className="text-gray-500 text-xs md:text-sm mt-1">Please answer all required questions below.</p>
                </div>
                <div className="p-4 md:p-8 space-y-6 md:space-y-8 overflow-y-auto max-h-[60vh] md:max-h-[600px]">
                    {questions.map((q, i) => (
                        <div key={i}>
                            <label className="block text-sm md:text-base font-semibold text-gray-800 mb-2 md:mb-3 flex gap-1">
                                <span className="text-gray-400 font-mono w-5 md:w-6">{i + 1}.</span>
                                {q.question}
                                {q.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            {q.type === 'text' && (
                                <textarea className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-gray-50" rows={3} placeholder="Type your answer here..." value={surveyAnswers[i] || ''} onChange={(e) => handleSurveyChange(i, e.target.value)} />
                            )}
                            {q.type === 'multiple_choice' && (
                                <div className="space-y-2 ml-5 md:ml-7">
                                    {q.options?.map((opt, optIdx) => (
                                        <label key={optIdx} className="flex items-center gap-3 p-2.5 md:p-3 border rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition">
                                            <div className={`w-4 h-4 md:w-5 md:h-5 rounded-full border-2 flex items-center justify-center transition-colors ${surveyAnswers[i] === opt ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                                                {surveyAnswers[i] === opt && <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-white" />}
                                            </div>
                                            <input type="radio" name={`q-${i}`} value={opt} checked={surveyAnswers[i] === opt} onChange={() => handleSurveyChange(i, opt)} className="hidden" />
                                            <span className={`text-sm md:text-base ${surveyAnswers[i] === opt ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{opt}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                            {q.type === 'checkbox' && (
                                <div className="space-y-2 ml-5 md:ml-7">
                                    {q.options?.map((opt, optIdx) => {
                                        const currentAnswers = (surveyAnswers[i] as string[]) || [];
                                        const isChecked = currentAnswers.includes(opt);
                                        return (
                                            <label key={optIdx} className="flex items-center gap-3 p-2.5 md:p-3 border rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition">
                                                <div className={`w-4 h-4 md:w-5 md:h-5 rounded border-2 flex items-center justify-center transition-colors ${isChecked ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                                                    {isChecked && <div className="text-white text-xs font-bold">✓</div>}
                                                </div>
                                                <input type="checkbox" value={opt} checked={isChecked} onChange={(e) => {
                                                    const newVals = e.target.checked ? [...currentAnswers, opt] : currentAnswers.filter(a => a !== opt);
                                                    handleSurveyChange(i, newVals);
                                                }} className="hidden" />
                                                <span className={`text-sm md:text-base ${isChecked ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{opt}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                            {q.type === 'rating' && (
                                <div className="flex gap-2 ml-5 md:ml-7 flex-wrap">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button key={star} onClick={() => handleSurveyChange(i, star)}
                                            className={`p-1.5 md:p-2 rounded-lg border transition ${surveyAnswers[i] === star ? 'bg-yellow-50 border-yellow-400 text-yellow-600' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                                            <div className={`text-xl md:text-2xl mb-0.5 md:mb-1 ${surveyAnswers[i] >= star ? 'grayscale-0' : 'grayscale opacity-50'}`}>★</div>
                                            <div className="text-xs font-bold">{star}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const hasTools = config.tools && config.tools.length > 0;

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-gray-950 text-gray-200 font-sans">
            {/* Header */}
            <header className="bg-gray-900 border-b border-gray-800 flex flex-col md:flex-row items-start md:items-center justify-between px-3 md:px-4 py-2 md:py-0 md:h-14 z-20 shrink-0 gap-2 md:gap-0">
                <div className="flex items-center gap-2 md:gap-4 w-full md:w-auto">
                    <button onClick={onExit} className="p-1.5 md:p-2 hover:bg-gray-800 rounded-md text-gray-400" title="Back">
                        <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-xs md:text-sm font-semibold text-white flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-900 text-blue-200 border border-blue-800 uppercase">{task.type}</span>
                            <span className="truncate max-w-[150px] md:max-w-none">{task.title}</span>
                            {task.verificationType && (
                                <span className={`hidden sm:flex px-1.5 py-0.5 rounded items-center gap-1 text-[10px] font-bold border ${task.verificationType === 'Instant Auto-Pay' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : task.verificationType === 'Consensus' ? 'bg-blue-950 text-blue-400 border-blue-800' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                                    {task.verificationType === 'Instant Auto-Pay' ? <Zap className="w-2.5 h-2.5 fill-emerald-500" /> : task.verificationType === 'Consensus' ? <Users className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                                    {task.verificationType}
                                </span>
                            )}
                        </h1>
                        <p className="text-[10px] md:text-xs text-gray-400 truncate">
                            {task.subtitle} {task.reward && <span className="text-green-400 font-mono">• {task.reward}</span>}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3 md:gap-6 w-full md:w-auto justify-between md:justify-end">
                    <div className="flex items-center gap-1.5 text-xs md:text-sm text-gray-300">
                        <Timer className="w-3.5 h-3.5 md:w-4 md:h-4 text-gray-500" />
                        <span className="font-mono">{formatTime(elapsedSeconds)}</span>
                    </div>
                    <button onClick={handleSubmit} disabled={isSubmitting}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 md:px-6 py-1.5 rounded-full text-xs md:text-sm font-medium transition shadow-lg shadow-blue-900/20 flex items-center gap-1.5 md:gap-2 disabled:opacity-50">
                        {isSubmitting ? <><Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin" /> Sending...</> : <><span>Submit</span><ArrowRight className="w-3.5 h-3.5 md:w-4 md:h-4" /></>}
                    </button>
                </div>
            </header>

            {/* Mobile: Instructions collapsible */}
            <div className="md:hidden bg-gray-900 border-b border-gray-800">
                <button className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold text-gray-400 uppercase"
                    onClick={() => setShowInstructions(!showInstructions)}>
                    <span className="flex items-center gap-2"><Info className="w-3.5 h-3.5" /> Instructions</span>
                    {showInstructions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showInstructions && (
                    <div className="px-4 pb-3">
                        <p className="text-gray-300 text-xs leading-relaxed bg-gray-800/50 p-3 rounded-lg border border-gray-800 whitespace-pre-wrap">{config.instruction}</p>
                        {hasTools && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                                {config.tools?.map(tool => (
                                    <button key={tool} className="w-9 h-9 rounded hover:bg-gray-800 bg-gray-800/50 border border-gray-700 text-gray-300 flex items-center justify-center transition" title={tool}>
                                        {tool === 'draw' && <ScanLine className="w-4 h-4" />}
                                        {tool === 'select' && <MousePointer2 className="w-4 h-4" />}
                                        {tool === 'poly' && <Hexagon className="w-4 h-4" />}
                                        {tool === 'brush' && <Brush className="w-4 h-4" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <main className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
                {/* Desktop Left Sidebar */}
                <aside className="hidden md:flex w-64 bg-gray-900 border-r border-gray-800 flex-col z-10 shrink-0 h-full">
                    {hasTools && (
                        <div className="p-4 border-b border-gray-800">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-3">Tools</p>
                            <div className="flex flex-wrap gap-2">
                                {config.tools?.map(tool => (
                                    <button key={tool} className="w-10 h-10 rounded hover:bg-gray-800 bg-gray-800/50 border border-gray-700 text-gray-300 flex items-center justify-center transition hover:border-blue-500 hover:text-blue-400" title={tool}>
                                        {tool === 'draw' && <ScanLine className="w-5 h-5" />}
                                        {tool === 'select' && <MousePointer2 className="w-5 h-5" />}
                                        {tool === 'poly' && <Hexagon className="w-5 h-5" />}
                                        {tool === 'brush' && <Brush className="w-5 h-5" />}
                                    </button>
                                ))}
                            </div>
                            {(isDrawing || currentPoly || selectedBoxId || selectedPolyId) && (
                                <div className="mt-4 flex flex-col gap-2">
                                    {(selectedBoxId || selectedPolyId) && (
                                        <button onClick={deleteSelected} className="w-full py-2 px-3 bg-red-900/30 border border-red-900/50 hover:bg-red-900/50 text-red-200 text-xs rounded flex items-center justify-center gap-2 transition">
                                            <Trash2 className="w-3.5 h-3.5" /> Delete Selection
                                        </button>
                                    )}
                                    {(isDrawing || currentPoly) && (
                                        <button onClick={cancelAction} className="w-full py-2 px-3 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 text-xs rounded flex items-center justify-center gap-2 transition">
                                            <XCircle className="w-3.5 h-3.5" /> Cancel Drawing
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto p-5">
                        <div className="mb-6">
                            <p className="mb-2 font-bold text-gray-500 uppercase flex items-center gap-2 text-[10px]"><Info className="w-3.5 h-3.5" /> Instructions</p>
                            <p className="text-gray-300 text-xs leading-relaxed font-medium bg-gray-800/50 p-3 rounded-lg border border-gray-800 whitespace-pre-wrap">{config.instruction}</p>
                        </div>
                        {(config.exampleImageUrl || config.entityTags) && (
                            <div className="mt-4 pt-4 border-t border-gray-800">
                                <div className="bg-gray-800 p-2 rounded-lg border border-gray-700 mb-3 opacity-80 group/guide relative">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Visual Guide</p>
                                    <div className="relative cursor-zoom-in" onClick={() => setExpandedImage(config.exampleImageUrl || (config.entityTags ? "/ner_guide.png" : null))}>
                                        <img src={config.exampleImageUrl || (config.entityTags ? "/ner_guide.png" : "/bbox_tips_preview_1768020935499.png")} className="w-full rounded border border-gray-600 mb-2 object-cover" alt="Task Guide" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                    </div>
                                    <p className="text-[10px] text-gray-500 text-center">Click to expand</p>
                                </div>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Center Workspace */}
                <section className="flex-1 bg-gray-950 overflow-y-auto flex items-center justify-center p-3 md:p-8 min-h-[300px]">
                    {task.type === 'vision' && renderVision()}
                    {task.type === 'nlp' && renderNLP()}
                    {task.type === 'audio' && renderAudio()}
                    {task.type === 'form' && renderForm()}
                </section>

                {/* Right Panel */}
                <aside className="w-full md:w-80 bg-gray-900 border-t md:border-t-0 md:border-l border-gray-800 flex flex-col z-10 md:h-full">
                    {/* Mobile: collapsible */}
                    <button className="md:hidden w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold uppercase text-gray-400"
                        onClick={() => setShowClasses(!showClasses)}>
                        <span>{config.classes ? 'Select Answer' : 'Task Details'}</span>
                        {showClasses ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    <div className={`${showClasses ? 'flex' : 'hidden'} md:flex flex-col flex-1 overflow-hidden`}>
                        <div className="hidden md:flex border-b border-gray-800 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            <div className="px-5 py-3 text-blue-400 border-b-2 border-blue-500">
                                {config.classes ? 'Select Answer' : 'Task Details'}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-gray-900/40">
                            {config.classes && config.classes.length > 0 ? (
                                <div className="flex flex-wrap md:flex-col gap-2 md:gap-0">
                                    {config.classes.map(cls => (
                                        <div key={cls.id} onClick={() => setSelectedClassId(cls.id)}
                                            className={`flex items-center gap-2 md:gap-3 p-3 md:p-4 rounded-xl border-2 cursor-pointer transition-all md:mb-3 ${selectedClassId === cls.id ? 'border-blue-500 bg-blue-900/20' : 'border-gray-800 bg-gray-800/50 hover:border-gray-700 hover:bg-gray-800'}`}>
                                            <div className="w-3 h-3 md:w-4 md:h-4 rounded-full border-2 border-gray-700 flex items-center justify-center shrink-0">
                                                {selectedClassId === cls.id && <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-blue-400" />}
                                            </div>
                                            <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full opacity-70 shrink-0" style={{ backgroundColor: cls.color || '#ccc' }}></div>
                                            <span className={`text-xs md:text-sm font-semibold ${selectedClassId === cls.id ? 'text-blue-200' : 'text-gray-400'}`}>{cls.name}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-gray-600 text-xs mt-8 italic px-4">
                                    {config.classes ? "No options available." : "No specific options required."}
                                </div>
                            )}
                        </div>
                        <div className="p-3 md:p-4 border-t border-gray-800 bg-gray-900 shrink-0">
                            <div className="bg-blue-900/10 border border-blue-800/30 rounded-lg p-2.5 md:p-3">
                                <p className="text-[10px] text-blue-400 font-bold uppercase mb-1">Status</p>
                                <p className="text-xs text-gray-300">Ready to submit. Review your choice before clicking <b>Submit</b>.</p>
                            </div>
                        </div>
                    </div>
                </aside>
            </main>

            {expandedImage && (
                <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6 md:p-10" onClick={() => setExpandedImage(null)}>
                    <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2"><X className="w-6 h-6 md:w-8 md:h-8" /></button>
                    <img src={expandedImage} className="max-w-full max-h-full rounded-lg shadow-2xl border border-gray-800 object-contain" alt="Expanded Guide" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
};
