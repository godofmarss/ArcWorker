import React, { useState, useMemo, useEffect } from 'react';
import {
    DollarSign,
    Clock,
    ShieldCheck,
    Zap,
    Target,
    Type,
    Mic,
    Users,
    ArrowLeft,
    Search,
    Filter,
    Info,
    Database,
    FileText
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WorkerTaskInterface, TaskData, TaskConfig } from './WorkerTaskInterface';
import { useTasks } from '@/hooks/useTasks';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS } from '@/utils/contracts';
import { getSdk } from '@/utils/circle';

const MODULE_INFO: Record<string, { title: string, category: 'vision' | 'nlp' | 'audio' | 'data' }> = {
    'vision-bbox': { title: "Object Detection (Bounding Boxes)", category: 'vision' },
    'vision-class': { title: "Image Classification", category: 'vision' },
    'vision-seg': { title: "Semantic Segmentation", category: 'vision' },
    'image-classification': { title: "Image Classification", category: 'vision' },
    'object-verification': { title: "Object Verification", category: 'vision' },
    'nlp-ner': { title: "Named Entity Recognition (NER)", category: 'nlp' },
    'nlp-sentiment': { title: "Sentiment Analysis", category: 'nlp' },
    'nlp-trans': { title: "Translation", category: 'nlp' },
    'text-classification': { title: "Text Classification", category: 'nlp' },
    'language-detection': { title: "Language Detection", category: 'nlp' },
    'audio-transcribe': { title: "Audio Transcription", category: 'audio' },
    'audio-collect': { title: "Speech Collection", category: 'audio' },
    'data-enrich': { title: "Data Enrichment", category: 'data' },
    'survey': { title: "Market Research Survey", category: 'data' }
};

interface TaskOpportunity {
    id: string;
    moduleId: string;
    title: string;
    clientName: string;
    description: string;
    rewardPerTask: number;
    timePerTaskSec: number;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    verification: 'Consensus' | 'Manual' | 'Golden Set' | 'Instant Auto-Pay' | 'Manual Review';
    availableTasks: number;
    tags: string[];
    metadata?: any;
    groupKey?: string;
}

const MOCK_TASKS: TaskOpportunity[] = [
    {
        id: 'task-101',
        moduleId: 'vision-class',
        title: 'Retail Audit: Cereal Brand Detection',
        clientName: 'ShelfVision AI',
        description: 'Identify brands like Corn Flakes, Cheerios, etc., from supermarket photos.',
        rewardPerTask: 0.15,
        timePerTaskSec: 45,
        difficulty: 'Medium',
        verification: 'Manual Review',
        availableTasks: 1250,
        tags: ['Retail', 'Vision']
    },
    {
        id: 'task-102',
        moduleId: 'nlp-sentiment',
        title: 'Customer Review Sentiment',
        clientName: 'Shopify Partner',
        description: 'Analyze sentiment of reviews for a sustainable fashion brand.',
        rewardPerTask: 0.12,
        timePerTaskSec: 30,
        difficulty: 'Easy',
        verification: 'Consensus',
        availableTasks: 5000,
        tags: ['NLP', 'Fashion'],
        metadata: {
            options: ['Positive', 'Neutral', 'Negative'],
            desc: 'Analyze sentiment of reviews for a sustainable fashion brand.'
        }
    },
    {
        id: 'task-103',
        moduleId: 'vision-class',
        title: 'Traffic Signal Classification',
        clientName: 'SafeDriver AI',
        description: 'Classify traffic lights: Red, Green, Yellow, or Off in urban photos.',
        rewardPerTask: 0.05,
        timePerTaskSec: 10,
        difficulty: 'Easy',
        verification: 'Instant Auto-Pay',
        availableTasks: 800,
        tags: ['Autonomous Driving']
    },
    {
        id: 'task-104',
        moduleId: 'nlp-trans',
        title: 'Spanish-English Translation Review',
        clientName: 'ArcTranslate',
        description: 'Verify translation accuracy for technical documentation snippets.',
        rewardPerTask: 0.50,
        timePerTaskSec: 60,
        difficulty: 'Hard',
        verification: 'Manual Review',
        availableTasks: 3200,
        tags: ['Language', 'Hard']
    }
];

interface WorkerTaskFeedProps {
    onBack: () => void;
}

export const WorkerTaskFeed: React.FC<WorkerTaskFeedProps> = ({ onBack }) => {
    const { address: wagmiAddress, isConnected } = useAccount();
    const [circleAddress, setCircleAddress] = useState<string | null>(null);
    const userAddress = wagmiAddress || circleAddress;
    const { allTasks: rawTasks, isLoading, refetch, markAsParticipated } = useTasks(undefined, userAddress || undefined);
    const [selectedTask, setSelectedTask] = useState<any>(null);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('arc_user');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    const addr = parsed.address || parsed.walletAddress;
                    if (addr) setCircleAddress(addr);
                } catch (e) { }
            }
        }
    }, []);

    const [recentlySubmitted, setRecentlySubmitted] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (typeof window !== 'undefined' && userAddress) {
            const cacheKey = `arc_submitted_tasks_${userAddress.toLowerCase()}`;
            const saved = localStorage.getItem(cacheKey);
            if (saved) setRecentlySubmitted(new Set(JSON.parse(saved)));
            else setRecentlySubmitted(new Set());
        } else if (!userAddress) {
            setRecentlySubmitted(new Set());
        }
    }, [userAddress]);

    useEffect(() => {
        if (typeof window !== 'undefined' && userAddress && recentlySubmitted.size > 0) {
            const cacheKey = `arc_submitted_tasks_${userAddress.toLowerCase()}`;
            localStorage.setItem(cacheKey, JSON.stringify(Array.from(recentlySubmitted)));
        }
    }, [recentlySubmitted, userAddress]);

    const router = useRouter();
    const searchParams = useSearchParams();

    const updateUrl = (taskId: string | number | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (taskId) params.set('taskId', taskId.toString());
        else params.delete('taskId');
        router.replace(`?${params.toString()}`, { scroll: false });
    };

    const availableTasks: TaskOpportunity[] = useMemo(() => {
        if (!rawTasks) return [];
        const now = Math.floor(Date.now() / 1000);
        const currentUserLower = userAddress?.toLowerCase();

        const getGroupKey = (t: any) => {
            if (t.campaignId) return t.campaignId.toString();
            const cleanTitle = (t.title || 'Untitled').trim().toLowerCase();
            const agency = (t.agency || 'Unknown').toLowerCase();
            if (cleanTitle !== 'unknown' && cleanTitle !== 'untitled') return `campaign-${cleanTitle}-${agency}`;
            if (t.metadataHash && t.metadataHash.length > 5) return `hash-${t.metadataHash.substring(0, 100)}`;
            return `single-${t.id}`;
        };

        const participatedGroups = new Set<string>();
        if (currentUserLower) {
            rawTasks.forEach((t: any) => {
                const groupKey = getGroupKey(t);
                const idStr = t.id.toString();
                const isParticipated = t.hasParticipated ||
                    recentlySubmitted.has(idStr) ||
                    recentlySubmitted.has(groupKey) ||
                    (t.metadataHash && recentlySubmitted.has(t.metadataHash));
                if (isParticipated) participatedGroups.add(groupKey);
            });
        }

        const groups: Record<string, any[]> = {};
        rawTasks.forEach((t: any) => {
            const groupKey = getGroupKey(t);
            const isAvailable = (t.status === 0 || t.status === 1) &&
                Number(t.currentSubmissions) < Number(t.requiredSubmissions) &&
                Number(t.deadline) > now &&
                !recentlySubmitted.has(t.id.toString()) &&
                !recentlySubmitted.has(groupKey) &&
                !t.hasParticipated;
            if (isAvailable) {
                if (!groups[groupKey]) groups[groupKey] = [];
                groups[groupKey].push(t);
            }
        });

        const opportunities: TaskOpportunity[] = [];
        Object.entries(groups).forEach(([groupKey, tasksInGroup]) => {
            if (participatedGroups.has(groupKey)) return;
            const representative = tasksInGroup[0];
            const metadata = representative.metadata || {};
            let verificationLabel = metadata.verification || metadata.verificationStrategy || 'Manual Review';
            if (representative.correctAnswerHash && representative.correctAnswerHash !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
                verificationLabel = 'Instant Auto-Pay';
            } else if (representative.requiredSubmissions > 1) {
                verificationLabel = 'Consensus';
            } else {
                verificationLabel = 'Manual Review';
            }
            const moduleId = metadata.tmpl || metadata.moduleId || metadata.mod || 'vision-class';
            const category = MODULE_INFO[moduleId]?.category || 'vision';
            opportunities.push({
                id: representative.id.toString(),
                moduleId,
                title: metadata.title || representative.title || "Untitled Task",
                clientName: representative.agency?.substring(0, 8) + '...',
                description: metadata.desc || representative.description || "No description provided.",
                rewardPerTask: parseFloat(representative.reward),
                timePerTaskSec: metadata.timePerTaskSec || 45,
                difficulty: metadata.diff || metadata.difficulty || 'Medium',
                verification: verificationLabel,
                availableTasks: tasksInGroup.length,
                tags: metadata.tags || [category.toUpperCase()],
                metadata: { ...metadata, metadataHash: representative.metadataHash },
                groupKey
            });
        });

        return opportunities;
    }, [rawTasks, userAddress, recentlySubmitted]);

    const tasksToShow = (rawTasks && rawTasks.length > 0) ? availableTasks : MOCK_TASKS;

    const filteredTasks = useMemo(() => {
        if (!searchQuery.trim()) return tasksToShow;
        const q = searchQuery.toLowerCase();
        return tasksToShow.filter(t =>
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.tags.some(tag => tag.toLowerCase().includes(q))
        );
    }, [tasksToShow, searchQuery]);

    const getTaskConfig = (task: any): TaskConfig => {
        const metadata = task.metadata || {};
        const moduleId = metadata.tmpl || metadata.moduleId || metadata.mod || 'vision-class';
        const instruction = metadata.desc || "Follow the prompt to complete the task.";
        const options: string[] = Array.isArray(metadata.options) ? metadata.options : [];
        const classes = options.map((opt, i) => ({
            id: opt,
            name: opt,
            color: `hsl(${(i * 137) % 360}, 70%, 50%)`
        }));

        switch (moduleId) {
            case 'vision-bbox':
                return { instruction, tools: ['draw', 'select'], classes: classes.length > 0 ? classes : [{ id: 1, name: 'Object A', color: '#fbbf24' }, { id: 2, name: 'Object B', color: '#f97316' }] };
            case 'vision-seg':
                return { instruction, tools: ['poly', 'select'], classes };
            case 'nlp-ner':
                return { instruction, entityTags: metadata.entityTags || ['Person', 'Organization', 'Location'], classes: [] };
            case 'image-classification':
            case 'vision-class':
            case 'object-verification':
                return { instruction, classes };
            case 'text-classification':
            case 'nlp-sentiment':
            case 'language-detection':
                const nlpClasses = classes.length > 0 ? classes : (moduleId === 'nlp-sentiment' ? [
                    { id: 'Positive', name: 'Positive', color: '#10b981' },
                    { id: 'Neutral', name: 'Neutral', color: '#6b7280' },
                    { id: 'Negative', name: 'Negative', color: '#ef4444' }
                ] : []);
                return { instruction, classes: nlpClasses, hasTranslationInput: moduleId === 'nlp-trans' || moduleId === 'language-detection' };
            default:
                return { instruction, classes };
        }
    };

    const [isSubmitting, setIsSubmitting] = useState(false);
    const { writeContractAsync: writeSubmit, data: submitHash } = useWriteContract();
    const { isLoading: isSubmitConfirming, isSuccess: isSubmitConfirmed } = useWaitForTransactionReceipt({ hash: submitHash });

    useEffect(() => {
        if (isSubmitConfirmed) {
            refetch();
            setIsSubmitting(false);
            setSelectedTask(null);
        }
    }, [isSubmitConfirmed]);

    const handleSubmission = async (result: any) => {
        if (!selectedTask) return;
        try {
            setIsSubmitting(true);
            const answer =
                (result.output.boxes && result.output.boxes.length > 0) ? JSON.stringify(result.output.boxes) :
                    (result.output.polygons && result.output.polygons.length > 0) ? JSON.stringify(result.output.polygons) :
                        result.output.classification ||
                        result.output.text ||
                        (result.output.ner ? JSON.stringify(result.output.ner) : "") || "";

            const triggerAutoVerify = async (id: string) => {
                try {
                    const res = await fetch('/api/tasks/auto-verify', { method: 'POST', body: JSON.stringify({ taskId: id }) });
                    const d = await res.json();
                    if (d.success) alert(`Auto-verification Success: ${d.message}`);
                    else alert(`Auto-verification Failed: ${d.error}`);
                } catch (e: any) { alert(`Auto-verification Error: ${e.message}`); }
            };

            const storedUser = localStorage.getItem('arc_user');
            const userProfile = storedUser ? JSON.parse(storedUser) : {};
            const isCircleUser = userProfile.walletType === 'circle' || !!userProfile.userId;

            if (isConnected && !isCircleUser) {
                await writeSubmit({
                    address: CONTRACTS.TaskEscrow.address,
                    abi: CONTRACTS.TaskEscrow.abi,
                    functionName: 'submitTask',
                    args: [BigInt(selectedTask.id), answer],
                });
                alert("Task submitted successfully via Wallet!");
                if (selectedTask.verification !== 'Manual Review') triggerAutoVerify(selectedTask.id);
                setRecentlySubmitted(prev => {
                    const next = new Set(prev);
                    next.add(selectedTask.id);
                    if (selectedTask.groupKey) next.add(selectedTask.groupKey);
                    if (selectedTask.metadata?.metadataHash) next.add(selectedTask.metadata.metadataHash);
                    return next;
                });
                markAsParticipated(selectedTask.id);
                return;
            }

            const circleUser = localStorage.getItem('arc_user');
            const sessionToken = localStorage.getItem('arc_session_token');
            const encryptionKey = localStorage.getItem('arc_encryption_key');

            if (circleUser) {
                const user = JSON.parse(circleUser);
                const userId = user.id || user.userId;
                const res = await fetch('/api/circle/submit-task', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, taskId: selectedTask.id, answer, userToken: sessionToken || undefined, encryptionKey: encryptionKey || undefined })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                if (data.challengeId) {
                    const sdk = getSdk();
                    if (!sdk) throw new Error("Circle SDK not initialized");
                    sdk.setAppSettings({ appId: data.appId });
                    sdk.setAuthentication({ userToken: data.userToken, encryptionKey: data.encryptionKey });
                    await new Promise((resolve, reject) => {
                        sdk.execute(data.challengeId, (error: any, result: any) => {
                            if (error) reject(error);
                            else resolve(result);
                        });
                    });
                }
                alert("Task submitted successfully via Circle!");
                if (selectedTask.verification !== 'Manual Review') triggerAutoVerify(selectedTask.id);
                setRecentlySubmitted(prev => {
                    const next = new Set(prev);
                    next.add(selectedTask.id);
                    if (selectedTask.groupKey) next.add(selectedTask.groupKey);
                    if (selectedTask.metadata?.metadataHash) next.add(selectedTask.metadata.metadataHash);
                    return next;
                });
                markAsParticipated(selectedTask.id);
                refetch();
                setSelectedTask(null);
                updateUrl(null);
            } else {
                alert("Please connect a wallet or sign in to submit tasks.");
            }
        } catch (err: any) {
            console.error(err);
            alert(`Submission Failed: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (selectedTask) {
        const metadata = selectedTask.metadata || {};
        const isVision = selectedTask.moduleId?.includes('vision') || selectedTask.moduleId?.includes('image') || selectedTask.moduleId?.includes('object');
        const isNLP = selectedTask.moduleId?.includes('nlp') || selectedTask.moduleId?.includes('text') || selectedTask.moduleId?.includes('language');
        const taskData: TaskData = {
            id: selectedTask.id.toString(),
            type: isVision ? 'vision' : isNLP ? 'nlp' : 'form',
            title: selectedTask.title,
            subtitle: selectedTask.clientName || 'Agency',
            reward: `$${selectedTask.rewardPerTask || selectedTask.reward} USDC`,
            verificationType: selectedTask.verification,
            imageUrl: metadata.content || metadata.imageUrl || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80',
            textContent: metadata.content || metadata.textContent || "Loading task content...",
            formData: metadata.questions || metadata.formData
        };
        return (
            <WorkerTaskInterface
                task={taskData}
                config={getTaskConfig(selectedTask)}
                onExit={() => { setSelectedTask(null); updateUrl(null); }}
                onSubmit={(res) => { handleSubmission(res); updateUrl(null); }}
            />
        );
    }

    const getDifficultyColor = (diff: string) => {
        switch (diff) {
            case 'Easy': return 'bg-green-100 text-green-700 border-green-200';
            case 'Medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case 'Hard': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    const getVerificationStyle = (ver: string) => {
        switch (ver) {
            case 'Consensus': return 'text-blue-600 bg-blue-50 border-blue-100 italic';
            case 'Manual Review': return 'text-purple-600 bg-purple-50 border-purple-100';
            case 'Instant Auto-Pay': return 'text-emerald-600 bg-emerald-50 border-emerald-100 font-bold';
            default: return 'text-gray-600 bg-gray-50 border-gray-100';
        }
    };

    const getModuleIcon = (category: string) => {
        switch (category) {
            case 'vision': return <Target className="w-3 h-3" />;
            case 'nlp': return <Type className="w-3 h-3" />;
            case 'audio': return <Mic className="w-3 h-3" />;
            case 'data': return <Database className="w-3 h-3" />;
            default: return <FileText className="w-3 h-3" />;
        }
    };

    return (
        <div className="w-full max-w-7xl mx-auto bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="mb-4 md:mb-6">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-gray-700 mb-2 transition"
                >
                    <ArrowLeft className="w-3 h-3" /> Back to Dashboard
                </button>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h1 className="text-lg md:text-2xl font-bold text-gray-900 flex gap-2 items-center">
                        Task Market
                        <span className="text-xs font-normal text-gray-400 border border-gray-200 px-2 py-0.5 rounded-full">
                            {filteredTasks.length} active
                        </span>
                    </h1>

                    {/* Search bar - full width on mobile */}
                    <div className="relative w-full sm:w-auto">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search tasks..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full sm:w-56 pl-9 pr-4 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-xs"
                        />
                    </div>
                </div>
            </div>

            {/* Task List */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16 animate-pulse">
                    <div className="w-10 h-10 bg-gray-200 rounded-full mb-4"></div>
                    <div className="h-4 w-40 bg-gray-200 rounded mb-2"></div>
                    <div className="h-3 w-28 bg-gray-100 rounded"></div>
                </div>
            ) : filteredTasks.length === 0 ? (
                <div className="py-16 text-center bg-white border border-dashed border-gray-200 rounded-xl">
                    <p className="text-gray-400 text-sm">No tasks found{searchQuery ? ' matching your search' : ''}.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3">
                    {filteredTasks.map((task) => {
                        const moduleInfo = MODULE_INFO[task.moduleId] || { title: 'Unknown Task', category: 'data' };
                        const isExpanded = expandedTaskId === task.id;

                        return (
                            <div key={task.id}
                                className={`bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-all overflow-hidden ${isExpanded ? 'ring-2 ring-blue-500/20' : ''}`}>

                                <div className="p-3 md:p-4 relative">
                                    {/* Left accent bar */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${task.difficulty === 'Easy' ? 'bg-green-500' : task.difficulty === 'Medium' ? 'bg-yellow-500' : 'bg-red-500'}`}></div>

                                    <div className="ml-3">
                                        {/* Top row: client + verification badge */}
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{task.clientName}</span>
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${getVerificationStyle(task.verification)} flex items-center gap-1`}>
                                                {task.verification === 'Instant Auto-Pay' ? <Zap className="w-2.5 h-2.5 fill-current" /> :
                                                    task.verification === 'Consensus' ? <Users className="w-2.5 h-2.5" /> :
                                                        <Clock className="w-2.5 h-2.5" />}
                                                {task.verification}
                                            </span>
                                        </div>

                                        {/* Title */}
                                        <h3 className="text-sm md:text-base font-bold text-gray-900 mb-1 leading-snug">{task.title}</h3>

                                        {/* Description - only when not expanded */}
                                        {!isExpanded && (
                                            <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 mb-2">{task.description}</p>
                                        )}

                                        {/* Tags row */}
                                        <div className="flex items-center gap-1.5 flex-wrap mb-3">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getDifficultyColor(task.difficulty)}`}>
                                                {task.difficulty}
                                            </span>
                                            <span className="flex items-center gap-1 text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded text-[10px] font-medium border border-gray-100">
                                                {getModuleIcon(moduleInfo.category)}
                                                <span className="hidden sm:inline">{moduleInfo.title}</span>
                                                <span className="sm:hidden">{moduleInfo.category.toUpperCase()}</span>
                                            </span>
                                            <span className="flex items-center gap-1 text-gray-400 text-[10px]">
                                                <Clock className="w-3 h-3" />~{task.timePerTaskSec}s
                                            </span>
                                            <span className="flex items-center gap-1 text-gray-400 text-[10px]">
                                                <Target className="w-3 h-3" />{task.availableTasks} left
                                            </span>
                                        </div>

                                        {/* Bottom row: reward + actions */}
                                        <div className="flex items-center justify-between gap-2">
                                            {/* Reward */}
                                            <div>
                                                <span className="text-lg md:text-xl font-bold text-gray-900">
                                                    <span className="text-xs text-gray-400 font-medium">$</span>
                                                    {task.rewardPerTask.toFixed(2)}
                                                </span>
                                                <span className="text-[10px] text-gray-400 uppercase ml-1">USDC</span>
                                            </div>

                                            {/* Action buttons */}
                                            <div className="flex items-center gap-2">
                                                <button
                                                    className={`h-8 w-8 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition flex items-center justify-center ${isExpanded ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white'}`}
                                                    onClick={(e) => { e.stopPropagation(); setExpandedTaskId(isExpanded ? null : task.id); }}
                                                    title="Details"
                                                >
                                                    <Info className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setSelectedTask(task); updateUrl(task.id); }}
                                                    className="bg-black text-white px-4 py-2 rounded-lg text-xs md:text-sm font-semibold hover:bg-gray-800 transition shadow-sm flex items-center gap-1.5 h-8"
                                                >
                                                    <Zap className="w-3 h-3" /> Start
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded details */}
                                {isExpanded && (
                                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100 ml-1">
                                        <p className="text-xs font-bold text-gray-500 uppercase mb-1">Full Description</p>
                                        <p className="text-xs md:text-sm text-gray-700 leading-relaxed mb-3">{task.description}</p>
                                        <div className="flex gap-2 flex-wrap">
                                            {task.tags?.map((tag: string, i: number) => (
                                                <span key={i} className="px-2 py-1 bg-white border border-gray-200 rounded text-[10px] text-gray-500 font-mono">
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
