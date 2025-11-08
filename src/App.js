import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import Papa from 'papaparse';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://quizzler-production.up.railway.app';

export default function QuizzlerHostApp() {
  const [socket, setSocket] = useState(null);
  const [screen, setScreen] = useState('login'); // Start at login, auth check will change if needed
  const [hostName, setHostName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueSpecials, setVenueSpecials] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [regularTimer, setRegularTimer] = useState(0); // 0 = no timer
  const [visualTimer, setVisualTimer] = useState(0); // 0 = no timer
  const [gameCode, setGameCode] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken'));
  const [resetToken, setResetToken] = useState(''); 
  const [resetEmail, setResetEmail] = useState('');  
  const [showTeamManagement, setShowTeamManagement] = useState(false);
  const [teamMembers, setTeamMembers] = useState({});
  
  // Game Library State
  const [gameTemplates, setGameTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [questionsAccordionOpen, setQuestionsAccordionOpen] = useState(false);
  
// Check authentication on load
useEffect(() => {
  const checkAuth = async () => {
    // Check for reset token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (token) {
      // Verify the reset token
      try {
        const response = await fetch(`${BACKEND_URL}/api/auth/verify-reset-token/${token}`);
        const data = await response.json();
        
        if (response.ok) {
          setResetToken(token);
          setResetEmail(data.email);
          setScreen('reset-password');
          return;
        } else {
          alert('Invalid or expired reset link');
          setScreen('login');
          return;
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        alert('Invalid reset link');
        setScreen('login');
        return;
      }
    }
    
    // Normal auth check
    if (!authToken) {
      setScreen('login');
      return;
    }
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.host);
        setIsAuthenticated(true);
        setScreen('start'); // Go to start screen instead of staying on login
      } else {
        localStorage.removeItem('authToken');
        setAuthToken(null);
        setScreen('login');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setScreen('login');
    }
  };
  
  checkAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);


  const [game, setGame] = useState({
    code: '',
    currentQuestionIndex: 0,
    questionNumber: 0
  });
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
  // FIXED: Changed 'question' to 'text' to match PostgreSQL schema
  const [questions, setQuestions] = useState(Array.from({ length: 16 }, () => ({ 
    category: '', 
    text: '',  // FIXED: was 'question'
    answer: '', 
    type: 'regular', 
    imageUrl: '' 
  })));
  const [finalQuestion, setFinalQuestion] = useState({ category: '', question: '', answer: '' });
  const [selectedTeamHistory, setSelectedTeamHistory] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [timerDuration, setTimerDuration] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [resumeGameCode, setResumeGameCode] = useState('');

    useEffect(() => {
  const newSocket = io(BACKEND_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });
  
  setSocket(newSocket);
  
  newSocket.on('connect', () => {
    console.log('Connected to server');
    
    if (gameCode) {
      console.log('Rejoining game:', gameCode);
      newSocket.emit('host:join', gameCode);
      
      // SYNC GAME STATE from database
      fetch(`${BACKEND_URL}/api/game/${gameCode}`)
        .then(res => res.json())
        .then(gameData => {
          console.log('Synced game state:', gameData);
          
          // Update current question index
          if (gameData.current_question_index !== undefined) {
            console.log('Setting question index to:', gameData.current_question_index);
            setSelectedQuestionIndex(gameData.current_question_index);
          }
          
          // Update teams with latest answers and scores
          if (gameData.teams) {
            setGame(prev => ({
              ...prev,
              currentQuestionIndex: gameData.current_question_index || 0,
              teams: gameData.teams.reduce((acc, team) => {
                acc[team.name] = {
                  name: team.name,
                  score: team.score,
                  usedConfidences: team.usedConfidences || [],
                  answers: team.answers || {}
                };
                return acc;
              }, {})
            }));
          }
        })
        .catch(err => console.error('Failed to sync game state:', err));
    }
  });  // ADDED: Close connect handler
  
  newSocket.on('disconnect', () => {
    console.log('Disconnected from backend - attempting to reconnect...');
  });
  
  newSocket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
  });
  
  newSocket.on('error', (error) => alert(error.message));
  
  return () => newSocket.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

useEffect(() => {
  if (!socket || !gameCode) return;
  
socket.on('host:joined', (data) => {
  console.log('Host joined:', data);
  setGameCode(data.gameCode);
  
  // Rebuild team members from current roster
  if (data.currentRoster) {
    const rebuiltMembers = {};
    data.currentRoster.forEach(player => {
      if (!rebuiltMembers[player.teamName]) {
        rebuiltMembers[player.teamName] = [];
      }
      rebuiltMembers[player.teamName].push({
        socketId: player.socketId,
        isCaptain: player.isCaptain
      });
    });
    setTeamMembers(rebuiltMembers);
    console.log('Rebuilt team roster:', rebuiltMembers);
  }
});
  
socket.on('host:teamJoined', (data) => {
  console.log('Team joined:', data);
  
  // Update team members tracking
  setTeamMembers(prev => {
    const updated = { ...prev };
    if (!updated[data.teamName]) {
      updated[data.teamName] = [];
    }
    
    // Check if player already in list (reconnection)
    const existingIndex = updated[data.teamName].findIndex(p => p.socketId === data.playerSocketId);
    
    if (existingIndex >= 0) {
      // Update existing player
      updated[data.teamName][existingIndex] = {
        socketId: data.playerSocketId,
        playerName: data.playerName,  // ADD THIS
        isCaptain: data.isCaptain
      };
    } else {
      // Add new player
      updated[data.teamName].push({
        socketId: data.playerSocketId,
        playerName: data.playerName,  // ADD THIS
        isCaptain: data.isCaptain
      });
    }
    
    return updated;
  });
  
  socket.on('host:playerDisconnected', (data) => {
  console.log('Player disconnected:', data);
  
  // Remove player from teamMembers
  setTeamMembers(prev => {
    const updated = { ...prev };
    if (updated[data.teamName]) {
      updated[data.teamName] = updated[data.teamName].filter(
        p => p.socketId !== data.socketId
      );
      
      // If team has no members left, remove the team
      if (updated[data.teamName].length === 0) {
        delete updated[data.teamName];
      }
    }
    return updated;
  });
});
  
  // Update game teams
  setGame(prev => {
    const newTeams = {};
    data.teams.forEach(team => {
      newTeams[team.name] = {
        name: team.name,
        score: team.score,
        usedConfidences: team.usedConfidences || [],
        answers: prev?.teams?.[team.name]?.answers || {}
      };
    });
    return { ...prev, teams: newTeams };
  });
});

    socket.on('host:answerReceived', ({ teamName, questionKey, answerText, confidence }) => {
      console.log('Answer received:', teamName, questionKey);
      setGame(prev => ({
        ...prev,
        teams: {
          ...prev.teams,
          [teamName]: {
            ...prev.teams[teamName],
            answers: {
              ...prev.teams[teamName]?.answers,
              [questionKey]: {
                text: answerText,
                confidence,
                marked: false,
                correct: false
              }
            }
          }
        }
      }));
    });

    socket.on('host:wagerReceived', (data) => {
  console.log('Wager data received:', data);
  console.log('Teams structure:', data.teams);
  
  setGame(prev => ({
    ...prev,
    teams: data.teams.reduce((acc, team) => {
      console.log('Processing team:', team.name, 'answers:', team.answers);
      acc[team.name] = team;
      return acc;
    }, {})
  }));
  console.log(`Wager received from ${data.teamName}: ${data.wager}`);
});
    socket.on('host:questionPushed', (data) => {
      console.log('Question pushed successfully');
      
      // Initialize timer if present
      if (data.timerDuration && data.timerDuration > 0) {
        setTimerDuration(data.timerDuration);
        setTimeRemaining(data.timerDuration);
        setTimerActive(true);
      } else {
        setTimerActive(false);
      }
      
      setScreen('scoring');
    });

    socket.on('host:scoresCorrected', (data) => {
      setGame(prev => {
        const updatedTeams = {};
        
        // Rebuild teams object completely to ensure React detects changes
        Object.keys(prev.teams).forEach(teamName => {
          const teamData = data.teams.find(t => t.name === teamName);
          
          if (teamData) {
            updatedTeams[teamName] = {
              ...prev.teams[teamName],
              score: teamData.score,
              answers: teamData.answers ? { ...teamData.answers } : prev.teams[teamName].answers
            };
          } else {
            updatedTeams[teamName] = prev.teams[teamName];
          }
        });
        
        return {
          ...prev,
          teams: updatedTeams
        };
      });
    });

    socket.on('host:questionResent', ({ teamName, success }) => {
      if (success) {
        console.log(`Question successfully resent to ${teamName}`);
        // Optionally show a success message or update UI
        alert(`Question resent to ${teamName}! Their answer has been cleared and confidence point restored.`);
      }
    });

    socket.on('host:answerCleared', ({ teamName, questionKey }) => {
      console.log(`Answer cleared for ${teamName}, question ${questionKey}`);
      setGame(prev => ({
        ...prev,
        teams: {
          ...prev.teams,
          [teamName]: {
            ...prev.teams[teamName],
            answers: {
              ...prev.teams[teamName].answers,
              [questionKey]: undefined // Remove the answer
            }
          }
        }
      }));
    });

    return () => {
      socket.off('host:joined');
      socket.off('host:teamJoined');
      socket.off('host:playerDisconnected');
      socket.off('host:answerReceived');
      socket.off('host:wagerReceived');
      socket.off('host:questionPushed');
      socket.off('host:scoresCorrected');
      socket.off('host:questionResent');
      socket.off('host:answerCleared');
    };
  }, [socket, gameCode]);

  // Timer countdown
  useEffect(() => {
    if (!timerActive || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          setTimerActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerActive, timeRemaining]);

  // Prevent accidental navigation away
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (game && gameCode) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [game, gameCode]);
  
  // Fetch game templates when library screen opens
  useEffect(() => {
    if (screen === 'library' && gameTemplates.length === 0) {
      fetchGameTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const formatTimer = () => {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const createGame = async () => {
    if (!hostName || !venueName) {
      alert('Please enter host name and venue name');
      return;
    }

    try {
      const response = await fetch(BACKEND_URL + '/api/game/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      setGameCode(data.gameCode);
      setGame({ hostName, venueName, venueSpecials, teams: {} });

      socket.emit('host:join', data.gameCode);
      socket.emit('host:setup', {
        gameCode: data.gameCode,
        hostName,
        venueName,
        venueSpecials,
        regularTimer,
        visualTimer
      });
      setScreen('library'); // Go to library to pick game
    } catch (error) {
      alert('Failed to create game');
      console.error(error);
    }
  };
  
  // Game Library Functions
  const fetchGameTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/templates`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch templates');
      
      const data = await response.json();
      setGameTemplates(data.templates);
    } catch (error) {
      console.error('Error fetching templates:', error);
      alert('Failed to load game library');
    } finally {
      setLoadingTemplates(false);
    }
  };
  
  const previewTemplate = async (templateId) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/templates/${templateId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch template');
      
      const data = await response.json();
      setSelectedTemplate(data.template);
      setShowPreviewModal(true);
    } catch (error) {
      console.error('Error fetching template:', error);
      alert('Failed to load template preview');
    }
  };
  
  const importTemplate = async (templateId) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/templates/${templateId}/import`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ gameCode })
      });
      
      if (!response.ok) throw new Error('Failed to import template');
      
      const data = await response.json();
      
      // Load the imported questions into state
      const game = await fetch(`${BACKEND_URL}/api/game/${gameCode}`).then(r => r.json());
      
      // Handle questions whether it's a string or already parsed
      let importedQuestions;
      if (typeof game.questions === 'string') {
        importedQuestions = JSON.parse(game.questions || '[]');
      } else {
        importedQuestions = game.questions || [];
      }
      
      // Separate regular questions, visual, and final
      const regularQuestions = importedQuestions.filter(q => q.type === 'regular' || !q.type);
      const visualQuestion = importedQuestions.find(q => q.type === 'visual');
      const finalQ = importedQuestions.find(q => q.type === 'final');
      
      // Create 16-slot array for all questions before final
      const newQuestions = Array.from({ length: 16 }, () => ({
        category: '',
        text: '',
        answer: '',
        type: 'regular',
        imageUrl: ''
      }));
      
      // Place Q1-Q7 in indices 0-6
      for (let i = 0; i < 7 && i < regularQuestions.length; i++) {
        newQuestions[i] = {
          category: regularQuestions[i].category || '',
          text: regularQuestions[i].text || '',
          answer: regularQuestions[i].answer || '',
          type: 'regular',
          imageUrl: regularQuestions[i].imageUrl || ''
        };
      }
      
      // Place visual question at index 7
      if (visualQuestion) {
        newQuestions[7] = {
          category: visualQuestion.category || '',
          text: visualQuestion.text || '',
          answer: visualQuestion.answer || '',
          type: 'visual',
          imageUrl: visualQuestion.imageUrl || ''
        };
      }
      
      // Place Q8-Q15 in indices 8-15 (remaining regular questions)
      for (let i = 7; i < regularQuestions.length && i < 15; i++) {
        newQuestions[i + 1] = {
          category: regularQuestions[i].category || '',
          text: regularQuestions[i].text || '',
          answer: regularQuestions[i].answer || '',
          type: 'regular',
          imageUrl: regularQuestions[i].imageUrl || ''
        };
      }
      
      setQuestions(newQuestions);
      
      // Set final question
      if (finalQ) {
        setFinalQuestion({
          category: finalQ.category || '',
          question: finalQ.text || '',
          answer: finalQ.answer || ''
        });
      }
      
      alert(`✅ ${data.questionCount} questions imported! You can review and edit them.`);
      setQuestionsAccordionOpen(false); // Accordion closed by default
      setScreen('welcome');
    } catch (error) {
      console.error('Error importing template:', error);
      alert('Failed to import template');
    }
  };
  
  // Authentication functions
  const handleSignup = async (email, password, name) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        alert(data.error || 'Signup failed');
        return false;
      }
      
      localStorage.setItem('authToken', data.token);
      setAuthToken(data.token);
      setCurrentUser(data.host);
      setIsAuthenticated(true);
      setScreen('start');
      return true;
    } catch (error) {
      console.error('Signup error:', error);
      alert('Signup failed');
      return false;
    }
  };

  const handleLogin = async (email, password) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        alert(data.error || 'Login failed');
        return false;
      }
      
      localStorage.setItem('authToken', data.token);
      setAuthToken(data.token);
      setCurrentUser(data.host);
      setIsAuthenticated(true);
      setScreen('start');
      return true;
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed');
      return false;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    setAuthToken(null);
    setCurrentUser(null);
    setIsAuthenticated(false);
    setScreen('login');
  };

  const updateQuestion = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setQuestions(newQuestions);
  };

  const downloadTemplate = () => {
  const headers = ['Category', 'Question', 'Answer', 'Type', 'Image URL'];
  const rows = [
    // Questions 1-7
    ['Science', 'What is H2O?', 'Water', 'regular', ''],
    ['History', 'Who was the first president?', 'George Washington', 'regular', ''],
    ['Sports', 'How many players on a basketball team?', '5', 'regular', ''],
    ['Geography', 'What is the capital of France?', 'Paris', 'regular', ''],
    ['Pop Culture', 'Who played Iron Man in the MCU?', 'Robert Downey Jr.', 'regular', ''],
    ['Music', 'What band released "Bohemian Rhapsody"?', 'Queen', 'regular', ''],
    ['Literature', 'Who wrote "1984"?', 'George Orwell', 'regular', ''],
    // Visual Round (after Q7)
    ['Logos', 'Name these 6 logos', 'Mitsubishi|Fila|Quaker|Wikipedia|NVIDIA|HBSC', 'visual', 'https://quizzler.pro/img/visual-102225.jpg'],
    // Questions 8-15
    ['Science', 'What planet is known as the Red Planet?', 'Mars', 'regular', ''],
    ['History', 'What year did World War II end?', '1945', 'regular', ''],
    ['Sports', 'Who has won the most Super Bowls?', 'Tom Brady', 'regular', ''],
    ['Geography', 'What is the largest ocean?', 'Pacific Ocean', 'regular', ''],
    ['Pop Culture', 'What streaming service created "Stranger Things"?', 'Netflix', 'regular', ''],
    ['Music', 'Who is known as the King of Pop?', 'Michael Jackson', 'regular', ''],
    ['Literature', 'What wizard school does Harry Potter attend?', 'Hogwarts', 'regular', ''],
    ['General', 'How many states are in the USA?', '50', 'regular', ''],
    // Final Question
    ['American History', 'In what year was the Declaration of Independence signed?', '1776', 'final', '']
  ];
  
  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'quizzler_template.csv';
  a.click();
};

  const handleImportCSV = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      const imported = results.data;
      const newQuestions = Array.from({ length: 16 }, () => ({
  category: '',
  text: '',
  answer: '',
  type: 'regular',
  imageUrl: ''
}));
      
      // Questions 1-7 (rows 0-6)
      for (let i = 0; i < 7 && i < imported.length; i++) {
        if (imported[i].Category && imported[i].Question && imported[i].Answer) {
          newQuestions[i] = {
            category: imported[i].Category,
            text: imported[i].Question,
            answer: imported[i].Answer,
            type: imported[i].Type || 'regular',
            imageUrl: imported[i]['Image URL'] || null
          };
        }
      }
      
      // Visual Round (row 7 - position 8 in template)
      if (imported.length > 7 && imported[7].Type === 'visual') {
        newQuestions[7] = {
          category: imported[7].Category,
          text: imported[7].Question,
          answer: imported[7].Answer,
          type: 'visual',
          imageUrl: imported[7]['Image URL'] || null
        };
      }
      
      // Questions 8-15 (rows 8-15 in CSV)
      for (let i = 8; i <= 15 && i < imported.length; i++) {
        if (imported[i].Category && imported[i].Question && imported[i].Answer) {
          newQuestions[i] = {
            category: imported[i].Category,
            text: imported[i].Question,
            answer: imported[i].Answer,
            type: imported[i].Type || 'regular',
            imageUrl: imported[i]['Image URL'] || null
          };
        }
      }
      
      // Final question (row 16 in CSV, after Q15)
      if (imported.length >= 17 && imported[16] && imported[16].Category && imported[16].Question && imported[16].Answer) {
        setFinalQuestion({
          category: imported[16].Category,
          question: imported[16].Question,
          answer: imported[16].Answer
        });
      }
      
      console.log('=== CSV IMPORT DEBUG ===');
      console.log('imported.length:', imported.length);
      console.log('newQuestions.length:', newQuestions.length);
      console.log('finalQuestion:', imported[16]);
      
      setQuestions(newQuestions);
      alert(`Successfully imported ${imported.length - 1} questions from CSV!`);
    },
    error: (error) => {
      alert('Error parsing CSV: ' + error.message);
    }
  });
  
  event.target.value = '';
};
    
  const continueToFirstQuestion = () => {
    setSelectedQuestionIndex(0);  // FIXED: Reset to 0
    setGame(prev => ({ ...prev, currentQuestionIndex: 0 }));
    setScreen('questionDisplay');
  };

  const pushQuestion = () => {
    console.log('Pushing question with index:', selectedQuestionIndex);
    console.log('Question details:', questions[selectedQuestionIndex]);
    socket.emit('host:pushQuestion', { 
  gameCode, 
  questionIndex: selectedQuestionIndex,
  questionData: questions[selectedQuestionIndex] 
});
  };

  const showStandings = () => {
    socket.emit('host:showStandings', { gameCode });
  };
  const toggleCorrectness = (teamName, questionKey) => {
    socket.emit('host:toggleCorrectness', { gameCode, teamName, questionKey });
  };

  const viewTeamHistory = (teamName) => {
    const team = game.teams[teamName];
    setSelectedTeamHistory({ teamName, team });
  };

  const closeHistory = () => {
    setSelectedTeamHistory(null);
  };

  const markAnswer = (teamName, correct) => {
  const questionKey = game.status === 'final' 
  ? 'final' 
  : questions[selectedQuestionIndex]?.type === 'visual'
    ? 'visual'
    : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);
  console.log('Marking answer - questionKey:', questionKey, 'selectedQuestionIndex:', selectedQuestionIndex);  
  const team = game.teams[teamName];
  const answer = team.answers[questionKey];

  socket.emit('host:markAnswer', { gameCode, teamName, questionKey, correct });

  let scoreChange = 0;
  
  if (game.status === 'final') {
    scoreChange = correct ? answer.confidence : -answer.confidence;
  } else {
    scoreChange = correct ? answer.confidence : 0;
  }

  setGame(prev => ({
    ...prev,
    teams: {
      ...prev.teams,
      [teamName]: {
        ...prev.teams[teamName],
        score: prev.teams[teamName].score + scoreChange,
        answers: {
          ...prev.teams[teamName].answers,
          [questionKey]: { ...answer, marked: true, correct }
        }
      }
    }
  }));
};

  const markVisualAnswer = (teamName, index, correct) => {
  const questionKey = questions[selectedQuestionIndex]?.type === 'visual' 
    ? 'visual' 
    : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);
  console.log('Marking visual answer - questionKey:', questionKey, 'index:', index, 'correct:', correct);
  
  const team = game.teams[teamName];
  const answer = team.answers[questionKey];
    
    if (!Array.isArray(answer.correct)) {
      answer.correct = [null, null, null, null, null, null];
    }
    
    answer.correct[index] = correct;
    
    setGame(prev => ({
      ...prev,
      teams: {
        ...prev.teams,
        [teamName]: {
          ...prev.teams[teamName],
          answers: {
            ...prev.teams[teamName].answers,
            [questionKey]: { ...answer }
          }
        }
      }
    }));
    
    const allMarked = answer.correct.every(val => val !== null);
    
    if (allMarked) {
      answer.marked = true;
      socket.emit('host:markAnswer', { 
        gameCode, 
        teamName, 
        questionKey, 
        correct: answer.correct 
      });
      
      const scoreChange = answer.correct.filter(val => val === true).length;
      
      setGame(prev => ({
        ...prev,
        teams: {
          ...prev.teams,
          [teamName]: {
            ...prev.teams[teamName],
            score: prev.teams[teamName].score + scoreChange,
            answers: {
              ...prev.teams[teamName].answers,
              [questionKey]: { ...answer, marked: true }
            }
          }
        }
      }));
    }
  };

  const nextQuestion = () => {
  // VALIDATION: Check if all answers are scored before advancing
  const { scored, total } = getScoringProgress();
  
  if (scored < total) {
    alert(`Please score all ${total} team answers before continuing. (${scored}/${total} scored)`);
    return;
  }
  
  // NEW: Check if all teams have submitted answers
const isCurrentVisual = questions[selectedQuestionIndex]?.type === 'visual';
const currentQ = isCurrentVisual 
  ? 'visual' 
  : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);

const teamsWithoutAnswers = getSortedTeams().filter(team => !team.answers?.[currentQ]);  // ADD THIS LINE
  
if (teamsWithoutAnswers.length > 0) {
    const teamNames = teamsWithoutAnswers.map(t => t.name).join(', ');
    const confirmed = window.confirm(
      `${teamsWithoutAnswers.length} team(s) haven't submitted answers yet: ${teamNames}\n\n` +
      `Are you sure you want to proceed? Their answers will be marked incorrect.`
    );
    if (!confirmed) return;
  }
  
  const nextIndex = selectedQuestionIndex + 1;
  
  if (nextIndex >= 16) {  // Now have 16 questions (0-15)
    setGame(prev => ({ ...prev, status: 'final' }));
    setScreen('finalQuestionDisplay');
    return;
  }
  
  setSelectedQuestionIndex(nextIndex);
  setScreen('questionDisplay');
};

  const pushFinalCategory = () => {
    socket.emit('host:pushFinalCategory', { 
      gameCode, 
      category: finalQuestion.category 
    });
    setScreen('waitingForWagers');
  };

  const revealFinalQuestion = () => {
    socket.emit('host:revealFinalQuestion', { 
      gameCode,
      question: finalQuestion.question,
      answer: finalQuestion.answer
    });
    setScreen('finalScoring');
  };

  const endGame = () => {
    socket.emit('host:endGame', { gameCode });
    setScreen('endGame');
  };

  const pushFinalRankings = () => {
    socket.emit('host:pushFinalRankings', { gameCode });
    alert('Final rankings sent to all teams!');
  };

 const getScoringProgress = () => {
  if (!game?.teams) return { scored: 0, total: 0 };
  
  // Use same logic as nextQuestion to determine question key
  const isCurrentVisual = questions[selectedQuestionIndex]?.type === 'visual';
  const questionKey = game.status === 'final' 
    ? 'final' 
    : isCurrentVisual 
      ? 'visual' 
      : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);
  
  let scored = 0;
  let total = 0;
  
  Object.values(game.teams).forEach(team => {
    const answer = team.answers?.[questionKey];
    if (answer) {
      total++;
      if (answer.marked) scored++;
    }
  });
  
  return { scored, total };
};

  const getSortedTeams = () => {
    if (!game?.teams) return [];
    return Object.values(game.teams).sort((a, b) => b.score - a.score);
  };

  return (
    <div className="quizzler-host">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Paytone+One&family=Gabarito:wght@400;500;600;700&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Gabarito', sans-serif;
          background: #F5F5F5;
        }

        .quizzler-host {
          min-height: 110vh;
          background-image: url(https://quizzler.pro/img/quizzler-background.png);
          background-repeat: no-repeat;
          background-size: cover;
          background-position: center;
        }

        .header {
          background: linear-gradient(135deg, #FFFFCC 0%, #FFFF99 50%, #FFFF66 100%);
          padding: 30px 50px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          border-radius: 0 0 30px 30px;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .logo-icon {
          width: 50px;
          height: 50px;
        }

        .logo-text {
          font-family: 'Gabarito', sans-serif;
          font-size: 42px;
          color: #FF6600;
          letter-spacing: 2px;
        }

        .host-info {
          color: #286586;
          font-size: 18px;
          font-weight: 600;
        }

        .main-content {
          display: flex;
          gap: 30px;
          padding: 40px 50px;
          max-width: 1800px;
          margin: 0 auto;
        }

        .left-panel {
          flex: 1;
          background: white;
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .right-panel {
          width: 350px;
          background: white;
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }

        .teams-header {
          color: #286586;
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 20px;
          text-align: center;
        }

        .team-item {
          background: #F5F5F5;
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .team-score {
          color: #FF6600;
          font-weight: 700;
        }

        .section-title {
          color: #286586;
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 30px;
          text-align: center;
        }

        .input-field {
          width: 100%;
          padding: 15px;
          margin-bottom: 15px;
          border: 2px solid #E0E0E0;
          border-radius: 10px;
          font-size: 16px;
          font-family: 'Gabarito', sans-serif;
        }

        .input-field:focus {
          outline: none;
          border-color: #FF6600;
        }

        .submit-button {
          width: 100%;
          padding: 18px;
          background: #FF6600;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 20px;
          font-weight: 700;
          font-family: 'Gabarito', sans-serif;
          cursor: pointer;
          margin-top: 0px;
          transition: background 0.3s;
        }

        .submit-button:hover {
          background: #E65C00;
        }

        .continue-button {
          width: 100%;
          padding: 18px;
          background: #00AA00;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 20px;
          font-weight: 700;
          font-family: 'Gabarito', sans-serif;
          cursor: pointer;
          margin-top: 30px;
          transition: background 0.3s;
        }

        .continue-button:hover:not(:disabled) {
          background: #009900;
        }

        .continue-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .questions-grid {
          margin-bottom: 20px;
        }

        .question-group {
          margin-bottom: 10px;
        }
        
        .round-label {
         display: block;
         color: #286586;
         font-size: 22px;
         font-weight: 800;
         margin-bottom: 8px;
         margin-top: 10px;
        }

        .question-label {
          display: block;
          color: #286586;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 8px;
          margin-top: 10px;
        }

        .question-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #E0E0E0;
          border-radius: 8px;
          font-size: 14px;
          font-family: 'Gabarito', sans-serif;
        }

        .question-input:focus {
          outline: none;
          border-color: #FF6600;
        }

        .welcome-script {
          font-size: 18px;
          line-height: 1.8;
          color: #333;
          padding: 20px;
          background: #FFF9E6;
          border-radius: 15px;
          margin-bottom: 30px;
        }

        .question-display {
          font-size: 28px;
          line-height: 1.6;
          color: #286586;
          padding: 30px;
          background: #E3F2FD;
          border-radius: 15px;
          margin-bottom: 30px;
          text-align: center;
          font-weight: 600;
        }

        .answer-item {
          background: #F5F5F5;
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 15px;
        }

        .answer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }

        .team-name-large {
          font-size: 20px;
          font-weight: 700;
          color: #286586;
        }

        .answer-buttons {
          display: flex;
          gap: 10px;
        }

        .correct-button, .incorrect-button {
          width: 50px;
          height: 50px;
          border: none;
          border-radius: 8px;
          font-size: 24px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .correct-button {
          background: #00AA00;
          color: white;
        }

        .incorrect-button {
          background: #C60404;
          color: white;
        }

        .correct-button:hover, .incorrect-button:hover {
          transform: scale(1.1);
        }

        .answer-details {
          font-size: 16px;
          color: #333;
        }

        .leaderboard-item {
          background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .leaderboard-rank {
          font-size: 36px;
          font-weight: 700;
          color: white;
        }

        .leaderboard-name {
          font-size: 24px;
          font-weight: 700;
          color: white;
        }

        .leaderboard-score {
          font-size: 28px;
          font-weight: 700;
          color: white;
        }

        .game-code-display {
          font-size: 72px;
          font-weight: 700;
          color: #FF6600;
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 20px;
          margin-bottom: 30px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.12);
        }
      `}</style>
      
      
      {/* RESET PASSWORD SCREEN */}
{screen === 'reset-password' && (
  <>
    <div className="header">
      <div className="logo">
        <img 
          src="https://quizzler.pro/img/quizzler_logo.png" 
          alt="Quizzler Logo" 
          className="logo-icon"
          style={{ height: '30px', width: 'auto' }}
        />
      </div>
    </div>
    <div style={{ maxWidth: '400px', margin: '60px auto', padding: '40px' }}>
      <div className="section-title">RESET PASSWORD</div>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        {resetEmail ? `Resetting password for: ${resetEmail}` : 'Enter your new password'}
      </p>
      <input 
        className="input-field" 
        type="password"
        placeholder="New Password (min 6 characters)"
        value={loginPassword}
        onChange={(e) => setLoginPassword(e.target.value)}
      />
      <input 
        className="input-field" 
        type="password"
        placeholder="Confirm New Password"
        value={loginEmail}
        onChange={(e) => setLoginEmail(e.target.value)}
      />
      <button 
        className="submit-button" 
        onClick={async () => {
          if (loginPassword.length < 6) {
            alert('Password must be at least 6 characters');
            return;
          }
          if (loginPassword !== loginEmail) {
            alert('Passwords do not match');
            return;
          }
          
          try {
            const response = await fetch(`${BACKEND_URL}/api/auth/reset-password`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: resetToken, password: loginPassword })
            });
            
            const data = await response.json();
            
            if (response.ok) {
              alert('Password reset successfully! You can now log in.');
              setScreen('login');
              setLoginEmail('');
              setLoginPassword('');
            } else {
              alert(data.error || 'Failed to reset password');
            }
          } catch (error) {
            console.error('Reset password error:', error);
            alert('Failed to reset password');
          }
        }}
      >
        RESET PASSWORD
      </button>
      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button 
          onClick={() => setScreen('login')}
          style={{
            background: 'none',
            border: 'none',
            color: '#286586',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Back to login
        </button>
      </div>
    </div>
  </>
)}

{/* LOGIN SCREEN */}
      {screen === 'login' && (
        <>
          <div className="header">
  <div className="logo">
    <img 
      src="https://quizzler.pro/img/quizzler_logo.png" 
      alt="Quizzler Logo" 
      className="logo-icon"
      style={{ height: '30px', width: 'auto' }}
    />
  </div>
  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
    <span style={{ color: '#286586', fontWeight: '600' }}>
      Welcome, {currentUser?.name || 'Host'}
    </span>
  </div>
</div>
          <div style={{ maxWidth: '400px', margin: '60px auto', padding: '40px' }}>
            <div className="section-title">HOST LOGIN</div>
            <input 
  className="input-field" 
  type="email"
  placeholder="Email"
  value={loginEmail}
  onChange={(e) => setLoginEmail(e.target.value)}
/>
<input 
  className="input-field" 
  type="password"
  placeholder="Password"
  value={loginPassword}
  onChange={(e) => setLoginPassword(e.target.value)}
  onKeyPress={(e) => {
    if (e.key === 'Enter') {
      handleLogin(loginEmail, loginPassword);
    }
  }}
/>
<button 
  className="submit-button" 
  onClick={() => handleLogin(loginEmail, loginPassword)}
>
              LOGIN
            </button>
            {/* FORGOT PASSWORD - ADD HERE */}
<div style={{ textAlign: 'center', marginTop: '15px' }}>
  <button 
    onClick={async () => {
      const email = prompt('Enter your email address:');
      if (email) {
        try {
          const response = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          
          const data = await response.json();
          
          if (response.ok) {
            alert('Password reset email sent! Check your inbox.');
          } else {
            alert(data.error || 'Failed to send reset email');
          }
        } catch (error) {
          console.error('Forgot password error:', error);
          alert('Failed to send reset email');
        }
      }
    }}
    style={{
      background: 'none',
      border: 'none',
      color: '#286586',
      textDecoration: 'underline',
      cursor: 'pointer',
      fontSize: '14px'
    }}
  >
    Forgot password?
  </button>
</div>
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button 
                onClick={() => setScreen('signup')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#286586',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Don't have an account? Sign up
              </button>
            </div>
          </div>
          <div style={{ 
  textAlign: 'center', 
  marginTop: '40px', 
  paddingTop: '20px', 
  borderTop: '1px solid #E0E0E0',
  color: '#999',
  fontSize: '12px'
}}>
  © 2025 Quizzler. All rights reserved.
</div>
        </>
      )}

      {/* SIGNUP SCREEN */}
      {screen === 'signup' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
          </div>
          <div style={{ maxWidth: '400px', margin: '60px auto', padding: '40px' }}>
            <div className="section-title">CREATE ACCOUNT</div>
            <input 
  className="input-field" 
  placeholder="Full Name"
  value={signupName}
  onChange={(e) => setSignupName(e.target.value)}
/>
<input 
  className="input-field" 
  type="email"
  placeholder="Email"
  value={loginEmail}
  onChange={(e) => setLoginEmail(e.target.value)}
/>
<input 
  className="input-field" 
  type="password"
  placeholder="Password (min 6 characters)"
  value={loginPassword}
  onChange={(e) => setLoginPassword(e.target.value)}
/>
<button 
  className="submit-button" 
  onClick={() => handleSignup(loginEmail, loginPassword, signupName)}
>
              CREATE ACCOUNT
            </button>
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button 
                onClick={() => setScreen('login')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#286586',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                Already have an account? Log in
              </button>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: '15px' }}>
</div>
<div style={{ 
  textAlign: 'center', 
  marginTop: '40px', 
  paddingTop: '20px', 
  borderTop: '1px solid #E0E0E0',
  color: '#999',
  fontSize: '12px'
}}>
  © 2025 Quizzler. All rights reserved.
</div>
        </>
      )}

      {/* START SCREEN - existing code */}
      {screen === 'start' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <button 
              onClick={() => {
                const code = prompt('Enter 4-digit game code to resume:');
                if (code && code.length === 4) {
                  setResumeGameCode(code.toUpperCase());
                  // Trigger resume logic
                  (async () => {
                    try {
                      const response = await fetch(`${BACKEND_URL}/api/game/${code.toUpperCase()}`);
                      const gameData = await response.json();
                      
                      if (!gameData) {
                        alert('Game not found');
                        return;
                      }
                      
                      socket.emit('host:join', code.toUpperCase());
                      setGameCode(code.toUpperCase()); 
                      setHostName(gameData.host_name);
                      setVenueName(gameData.venue_name);
                      setVenueSpecials(gameData.venue_specials || '');
                      
                      // Ensure questions array has 16 slots
                      const loadedQuestions = gameData.questions || [];
                      const paddedQuestions = Array.from({ length: 16 }, (_, i) => 
                        loadedQuestions[i] || {
                          category: '',
                          text: '',
                          answer: '',
                          type: 'regular',
                          imageUrl: ''
                        }
                      );
                      setQuestions(paddedQuestions);
                      
                      setSelectedQuestionIndex(gameData.current_question_index || 0);
                      setGame({ 
                        ...gameData, 
                        currentQuestionIndex: gameData.current_question_index || 0,
                        teams: {} 
                      });
                      
                      const teams = await fetch(`${BACKEND_URL}/api/game/${code.toUpperCase()}`).then(r => r.json());
                      if (teams.teams) {
                        const teamsMap = {};
                        teams.teams.forEach(team => {
                          teamsMap[team.name] = {
                            name: team.name,
                            score: team.score,
                            usedConfidences: team.usedConfidences || [],
                            answers: team.answers || {}
                          };
                        });
                        setGame(prev => ({ ...prev, teams: teamsMap }));
                      }
                      
                      if (gameData.status === 'final') {
                        setScreen('finalQuestionDisplay');
                      } else if (gameData.status === 'completed') {
                        setScreen('endGame');
                      } else if (gameData.question_number > 0) {
                        setScreen('scoring');
                      } else {
                        setScreen('welcome');
                      }
                    } catch (error) {
                      console.error('Error resuming game:', error);
                      alert('Failed to resume game');
                    }
                  })();
                }
              }}
              style={{
                padding: '10px 20px',
                background: '#00AA00',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              📂 Resume Game
            </button>
          </div>
          <div style={{ maxWidth: '600px', margin: '30px auto', padding: '40px', background: 'white', borderRadius: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
            <div className="section-title">HOST SETUP</div>
      
      
      
      {/* EXISTING NEW GAME SECTION */}
      <h3 style={{ color: '#286586', marginBottom: '15px' }}>Start New Game</h3>
              <input 
              className="input-field" 
              placeholder="Host Name"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
            />
              <input 
              className="input-field" 
              placeholder="Venue Name"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
            />
            <textarea 
              className="input-field" 
              placeholder="Venue Specials (optional)"
              value={venueSpecials}
              onChange={(e) => setVenueSpecials(e.target.value)}
              rows={4}
              style={{ resize: 'vertical' }}
            />
            <label className="question-label" style={{ marginTop: '20px' }}>Regular Question Timer:</label>
            <select 
              className="input-field"
              value={regularTimer}
              onChange={(e) => setRegularTimer(parseInt(e.target.value))}
              style={{ padding: '15px' }}
            >
              <option value={0}>No Timer</option>
              <option value={1}>1 Minute</option>
              <option value={2}>2 Minutes</option>
              <option value={3}>3 Minutes</option>
              <option value={4}>4 Minutes</option>
              <option value={5}>5 Minutes</option>
            </select>
            <label className="question-label">Visual Round Timer:</label>
            <select 
              className="input-field"
              value={visualTimer}
              onChange={(e) => setVisualTimer(parseInt(e.target.value))}
              style={{ padding: '15px' }}
            >
              <option value={0}>No Timer</option>
              <option value={1}>1 Minute</option>
              <option value={2}>2 Minutes</option>
              <option value={3}>3 Minutes</option>
              <option value={4}>4 Minutes</option>
              <option value={5}>5 Minutes</option>
            </select>
            <button className="submit-button" onClick={createGame}>
              SUBMIT
            </button>

          </div>
        </>
      )}
      
      {/* GAME LIBRARY SCREEN */}
      {screen === 'library' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
          </div>
          
          <div style={{ maxWidth: '1000px', margin: '30px auto', padding: '40px' }}>
            <div style={{ textAlign: 'center', marginBottom: '40px' }}>
              <h1 style={{ color: '#286586', fontSize: '36px', margin: '0 0 10px 0' }}>📚 Choose Your Game</h1>
              <p style={{ color: '#666', fontSize: '18px', margin: '0 0 10px 0' }}>
                Select a pre-made trivia game to get started
              </p>
              <p style={{ color: '#999', fontSize: '14px', margin: '0' }}>
                Game Code: <strong style={{ color: '#286586', fontSize: '18px' }}>{gameCode}</strong>
              </p>
            </div>
            
            {loadingTemplates ? (
              <div style={{ textAlign: 'center', padding: '60px', color: '#286586', fontSize: '20px' }}>
                Loading games...
              </div>
            ) : gameTemplates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <div style={{ fontSize: '64px', marginBottom: '20px' }}>📦</div>
                <div style={{ color: '#666', fontSize: '18px' }}>
                  No games available yet. Check back soon!
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '25px' }}>
                {gameTemplates.map(template => (
                  <div 
                    key={template.id} 
                    style={{ 
                      background: 'white', 
                      borderRadius: '15px', 
                      padding: '25px', 
                      boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                      border: '2px solid #E0E0E0',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-5px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
                    }}
                  >
                    <div style={{ marginBottom: '15px' }}>
                      <h3 style={{ color: '#286586', fontSize: '22px', margin: '0 0 8px 0' }}>
                        {template.title}
                      </h3>
                      {template.description && (
                        <p style={{ color: '#666', fontSize: '14px', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                          {template.description}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {template.difficulty && (
                          <span style={{ 
                            background: template.difficulty === 'easy' ? '#E8F5E9' : template.difficulty === 'hard' ? '#FFEBEE' : '#FFF9E6',
                            color: template.difficulty === 'easy' ? '#2E7D32' : template.difficulty === 'hard' ? '#C62828' : '#F57C00',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold'
                          }}>
                            {template.difficulty.toUpperCase()}
                          </span>
                        )}
                        {template.category && (
                          <span style={{ 
                            background: '#E3F2FD',
                            color: '#286586',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold'
                          }}>
                            {template.category}
                          </span>
                        )}
                        <span style={{ 
                          background: '#F5F5F5',
                          color: '#666',
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          17 Questions
                        </span>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                      <button 
                        onClick={() => previewTemplate(template.id)}
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: '#286586',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        👁️ Preview
                      </button>
                      <button 
                        onClick={() => {
                          if (window.confirm(`Import "${template.title}" into your game?`)) {
                            importTemplate(template.id);
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: '#FF6600',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        ✓ Use This
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* BUILD YOUR OWN Section */}
            <div style={{ 
              textAlign: 'center', 
              marginTop: '60px',
              padding: '40px',
              background: '#F5F5F5',
              borderRadius: '15px',
              border: '2px dashed #286586'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '15px' }}>— or —</div>
              <h2 style={{ color: '#286586', fontSize: '28px', margin: '0 0 15px 0' }}>
                BUILD YOUR OWN
              </h2>
              <p style={{ color: '#666', fontSize: '16px', marginBottom: '25px' }}>
                Create a custom trivia game from scratch
              </p>
              <button
                onClick={() => {
                  setQuestionsAccordionOpen(true); // Open accordion for manual entry
                  setScreen('questions');
                }}
                style={{
                  padding: '15px 40px',
                  background: '#286586',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                }}
              >
                🛠️ Start Building
              </button>
            </div>
          </div>
          
          {/* Preview Modal */}
          {showPreviewModal && selectedTemplate && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              padding: '20px'
            }}>
              <div style={{
                background: 'white',
                borderRadius: '20px',
                maxWidth: '800px',
                width: '100%',
                maxHeight: '90vh',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ 
                  padding: '30px', 
                  borderBottom: '2px solid #E0E0E0',
                  background: '#F5F5F5'
                }}>
                  <h2 style={{ color: '#286586', margin: '0 0 10px 0', fontSize: '28px' }}>
                    {selectedTemplate.title}
                  </h2>
                  {selectedTemplate.description && (
                    <p style={{ color: '#666', margin: '0', fontSize: '16px' }}>
                      {selectedTemplate.description}
                    </p>
                  )}
                </div>
                
                <div style={{ 
                  padding: '30px', 
                  overflowY: 'auto',
                  flex: 1
                }}>
                  {selectedTemplate.questions && selectedTemplate.questions.map((q, idx) => (
                    <div key={idx} style={{ 
                      marginBottom: '25px',
                      padding: '20px',
                      background: q.type === 'visual' ? '#FFF9E6' : q.type === 'final' ? '#FFEBEE' : '#F5F5F5',
                      borderRadius: '10px',
                      border: q.type === 'visual' ? '2px solid #FFB300' : q.type === 'final' ? '2px solid #F44336' : '2px solid #E0E0E0'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ 
                          fontWeight: 'bold',
                          color: '#286586',
                          fontSize: '14px'
                        }}>
                          {q.type === 'visual' ? '📷 VISUAL ROUND' : q.type === 'final' ? '🏆 FINAL QUESTION' : `Q${idx + 1}`}
                        </div>
                        <div style={{ 
                          background: '#E3F2FD',
                          color: '#286586',
                          padding: '4px 10px',
                          borderRadius: '10px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          {q.category}
                        </div>
                      </div>
                      <div style={{ color: '#333', marginBottom: '10px', fontSize: '16px', fontWeight: '500' }}>
                        {q.text}
                      </div>
                      <div style={{ color: '#00AA00', fontWeight: 'bold', fontSize: '15px' }}>
                        ✓ {q.answer}
                      </div>
                      {q.image_url && (
                        <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                          📎 Image included
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                <div style={{ 
                  padding: '20px 30px', 
                  borderTop: '2px solid #E0E0E0',
                  display: 'flex',
                  gap: '15px',
                  background: '#F5F5F5'
                }}>
                  <button 
                    onClick={() => setShowPreviewModal(false)}
                    style={{
                      flex: 1,
                      padding: '15px',
                      background: '#666',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Close
                  </button>
                  <button 
                    onClick={() => {
                      if (window.confirm(`Import "${selectedTemplate.title}"?`)) {
                        setShowPreviewModal(false);
                        importTemplate(selectedTemplate.id);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '15px',
                      background: '#FF6600',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    ✓ Use This Game
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      
      {screen === 'questions' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
  <div>
    {hostName} | {venueName} | {gameCode}
    {timerActive && (
      <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
        ⏱️ {formatTimer()}
      </span>
    )}
  </div>
  <button
    onClick={handleLogout}
    style={{
      background: 'none',
      border: 'none',
      color: '#286586',
      textDecoration: 'underline',
      cursor: 'pointer',
      fontSize: '14px',
      marginTop: '5px'
    }}
  >
    Logout
  </button>
</div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">ENTER QUESTIONS</div>
              
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button 
                  className="submit-button" 
                  onClick={downloadTemplate}
                  style={{ flex: 1 }}
                >
                  Download Template
                </button>
                <label 
                  htmlFor="csv-upload" 
                  className="submit-button"
                  style={{ flex: 1, textAlign: 'center', cursor: 'pointer', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  Import CSV
                </label>
                <input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleImportCSV}
                  style={{ display: 'none' }}
                />
              </div>

              <div className="questions-grid">
                {questions.map((q, idx) => (
  <div key={idx} className="question-group">
    <div className="round-label">
      {idx === 7 ? 'VISUAL ROUND' : `Round ${idx < 7 ? idx + 1 : idx}`}
    </div>
    <label className="question-label">
      {idx === 7 ? 'Visual Round Category' : `Category ${idx < 7 ? idx + 1 : idx}`}
    </label>
    <input
      className="question-input"
      value={q.category}
      onChange={(e) => updateQuestion(idx, 'category', e.target.value)}
    />
    <label className="question-label">
      {idx === 7 ? 'Visual Round Question' : `Question ${idx < 7 ? idx + 1 : idx}`}
    </label>
    <input
      className="question-input"
      value={q.text}
      onChange={(e) => updateQuestion(idx, 'text', e.target.value)}
    />
    <label className="question-label">
      {idx === 7 ? 'Visual Round Answer' : `Answer ${idx < 7 ? idx + 1 : idx}`}
    </label>
    <input
      className="question-input"
      value={q.answer}
      onChange={(e) => updateQuestion(idx, 'answer', e.target.value)}
    />
    
    {idx === 7 && (
      <>
        <div style={{ 
          background: '#E3F2FD', 
          padding: '10px', 
          borderRadius: '5px',
          marginTop: '10px',
          marginBottom: '10px',
          color: '#286586',
          fontWeight: 'bold'
        }}>
          📸 VISUAL ROUND (appears after Q7)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
          <label className="question-label" style={{ marginBottom: 0, flex: 1 }}>Image URL</label>
          <button
            onClick={() => window.open('https://quizzler.pro/visual-round-creator.html', '_blank')}
            style={{
              background: '#10b981',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.3s'
            }}
            onMouseOver={(e) => e.target.style.background = '#059669'}
            onMouseOut={(e) => e.target.style.background = '#10b981'}
          >
            Create Visual Round
          </button>
        </div>
        <input
          className="question-input"
          placeholder="https://quizzler.pro/img/visual-example.jpg"
          value={q.imageUrl || ''}
          onChange={(e) => updateQuestion(idx, 'imageUrl', e.target.value)}
        />
      </>
    )}
                    
                    {idx < 14 && (
                      <hr style={{ 
                        border: 'none', 
                        borderTop: '1px solid #cccccc', 
                        margin: '20px 0 0 0' 
                      }} />
                    )}
                  </div>
                ))}
                <div className="question-group">
                  <label className="round-label">FINAL CATEGORY</label>
                  <input
                    className="question-input"
                    value={finalQuestion.category}
                    onChange={(e) => setFinalQuestion(prev => ({ ...prev, category: e.target.value }))}
                  />
                  <label className="question-label">FINAL QUESTION</label>
                  <input
                    className="question-input"
                    value={finalQuestion.question}
                    onChange={(e) => setFinalQuestion(prev => ({ ...prev, question: e.target.value }))}
                  />
                  <label className="question-label">FINAL ANSWER</label>
                  <input
                    className="question-input"
                    value={finalQuestion.answer}
                    onChange={(e) => setFinalQuestion(prev => ({ ...prev, answer: e.target.value }))}
                  />
                </div>
              </div>
              <button className="submit-button" onClick={() => {
  console.log('=== BEFORE FILTERING ===');
  console.log('questions array length:', questions.length);
  console.log('finalQuestion:', finalQuestion);
  
  const validQuestions = questions.filter(q => q.text && q.answer);
  if (validQuestions.length < 15) {
    alert('Please fill in all 15 questions and answers');
    return;
  }

  // Add the final question to make 17 total
  const allQuestions = [...validQuestions, {
    type: 'final',
    category: finalQuestion.category,
    text: finalQuestion.question,  // finalQuestion uses 'question' not 'text'
    answer: finalQuestion.answer,
    number: null
  }];

  console.log('=== SENDING QUESTIONS ===');
  console.log('validQuestions length:', validQuestions.length);
  console.log('allQuestions length:', allQuestions.length);
  console.log('Questions summary:', allQuestions.map((q, idx) => ({ 
    index: idx, 
    type: q.type || 'regular', 
    hasText: !!q.text, 
    hasAnswer: !!q.answer,
    text: q.text?.substring(0, 40) + '...'
  })));

  socket.emit('host:addAllQuestions', {
    gameCode,
    questions: allQuestions
  });

  setScreen('welcome');
}}>
  START
</button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
              {getSortedTeams().length === 0 && (
                <p style={{ color: '#999', textAlign: 'center' }}>Waiting for teams...</p>
              )}
            </div>
          </div>
        </>
      )}

      {screen === 'welcome' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="welcome-script">
                Welcome to Quizzler Trivia at {venueName}! I'm your host {hostName}.
                <br/><br/>
                While we wait for all of the teams to join, let me tell you about our drink specials tonight.
                <br/><br/>
                {venueSpecials}
                <br/><br/>
                OK...I'm going to run through the rules of the game.
                <br/><br/>
                We have 15 questions from various categories. Those questions will be sent to your device. Each question has to have a confidence score from 1 to 15, but you can only use each number one time. If you are very confident in your answer, give it higher points. Lower confidence, lower points. Get it? You get 2 minutes to answer each question.
                <br/><br/>
                There is also a Visual Round where we will show you 6 images to identify. Each answer is worth 1 point for a possible total of 6 points for that round. 
                <br/><br/>
                You will be able to see your current score after each question. I'll give you team standings at various points throughout the game.
                <br/><br/>
                At the end of the 15 rounds, we will have a final question where you can wager up to 30pts. If you get the final answer correct, your wager will be added to your final score. However, if you get it wrong, the wager will be deducted from your final score. Before you get the final answer, I will give you the category and give you a moment to put in your wager. Once all wagers are in, I will send you the final question.
                <br/><br/>
                Winners will get $20 and the second place team will get $10. Second to last place will receive $5.
                <br/><br/>
                Any questions? OK! Let's get started!
              </div>
              
              {/* Questions Review Accordion */}
              <div style={{ marginTop: '30px', marginBottom: '20px' }}>
                <button
                  onClick={() => setQuestionsAccordionOpen(!questionsAccordionOpen)}
                  style={{
                    width: '100%',
                    padding: '15px 20px',
                    background: '#286586',
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '10px'
                  }}
                >
                  <span>📝 REVIEW QUESTIONS</span>
                  <span>{questionsAccordionOpen ? '▼' : '▶'}</span>
                </button>
                
                {questionsAccordionOpen && (
                  <div style={{ 
                    background: '#F5F5F5', 
                    padding: '20px', 
                    borderRadius: '10px',
                    maxHeight: '600px',
                    overflowY: 'auto'
                  }}>
                    {/* Import buttons */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                      <button 
                        onClick={downloadTemplate}
                        style={{ 
                          flex: 1,
                          padding: '10px',
                          background: '#286586',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Download Template
                      </button>
                      <label 
                        htmlFor="csv-upload-welcome" 
                        style={{ 
                          flex: 1,
                          padding: '10px',
                          background: '#FF6600',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        Import CSV
                      </label>
                      <input
                        id="csv-upload-welcome"
                        type="file"
                        accept=".csv"
                        onChange={handleImportCSV}
                        style={{ display: 'none' }}
                      />
                    </div>
                    
                    {/* Questions list */}
                    <div style={{ fontSize: '12px' }}>
                      {questions.map((q, idx) => (
                        <div key={idx} style={{ 
                          background: 'white', 
                          padding: '15px', 
                          borderRadius: '8px', 
                          marginBottom: '10px',
                          border: idx === 7 ? '2px solid #FFB300' : '1px solid #ddd'
                        }}>
                          <div style={{ fontWeight: 'bold', color: '#286586', marginBottom: '8px' }}>
                            {idx === 7 ? '📷 VISUAL ROUND' : `Question ${idx < 7 ? idx + 1 : idx}`}
                          </div>
                          <div style={{ marginBottom: '5px' }}>
                            <strong>Category:</strong> {q.category || '—'}
                          </div>
                          <div style={{ marginBottom: '5px' }}>
                            <strong>Question:</strong> {q.text || '—'}
                          </div>
                          <div>
                            <strong>Answer:</strong> {q.answer || '—'}
                          </div>
                          {idx === 7 && q.imageUrl && (
                            <div style={{ marginTop: '5px', color: '#00AA00' }}>
                              ✓ Image URL set
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {/* Final Question */}
                      <div style={{ 
                        background: 'white', 
                        padding: '15px', 
                        borderRadius: '8px',
                        border: '2px solid #F44336'
                      }}>
                        <div style={{ fontWeight: 'bold', color: '#286586', marginBottom: '8px' }}>
                          🏆 FINAL QUESTION
                        </div>
                        <div style={{ marginBottom: '5px' }}>
                          <strong>Category:</strong> {finalQuestion.category || '—'}
                        </div>
                        <div style={{ marginBottom: '5px' }}>
                          <strong>Question:</strong> {finalQuestion.question || '—'}
                        </div>
                        <div>
                          <strong>Answer:</strong> {finalQuestion.answer || '—'}
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => setScreen('questions')}
                      style={{
                        width: '100%',
                        marginTop: '15px',
                        padding: '12px',
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      ✏️ Edit Questions
                    </button>
                  </div>
                )}
              </div>
              
              <button className="continue-button" onClick={continueToFirstQuestion}>
                CONTINUE
              </button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'questionDisplay' && game?.currentQuestionIndex !== undefined && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
  {questions[selectedQuestionIndex]?.type === 'visual' ? (
    <>
      VISUAL ROUND
      <br/><br/>
      The category is {questions[selectedQuestionIndex]?.category || 'N/A'}
      <br/><br/>
      {questions[selectedQuestionIndex]?.text}
    </>
  ) : (
    <>
      Question {selectedQuestionIndex < 7 ? selectedQuestionIndex + 1 : selectedQuestionIndex}...
      <br/><br/>
      The category is {questions[selectedQuestionIndex]?.category || 'N/A'}
      <br/><br/>
      {questions[selectedQuestionIndex]?.text}
    </>
  )}
</div>

<button 
  onClick={pushQuestion}
  className="submit-button"
>
  {questions[selectedQuestionIndex]?.type === 'visual' 
    ? 'PUSH VISUAL ROUND TO TEAMS'
    : `PUSH QUESTION ${selectedQuestionIndex < 7 ? selectedQuestionIndex + 1 : selectedQuestionIndex} TO TEAMS`
  }
</button>

<button 
  onClick={showStandings}
  className="submit-button"
  style={{ 
    marginTop: '15px', 
    background: '#32ADE6'
  }}
>
  📊 SHOW STANDINGS TO TEAMS
</button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'scoring' && game?.currentQuestionIndex !== undefined && (
        <>
<div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>

          {/* Manage Teams Button */}
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <button 
              onClick={() => setShowTeamManagement(!showTeamManagement)}
              style={{ 
                padding: '15px 30px', 
                fontSize: '18px', 
                fontWeight: 'bold',
                background: '#32ADE6',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer'
              }}
            >
              {showTeamManagement ? 'Hide' : 'Manage Teams'}
            </button>
          </div>

          {/* Team Management Panel */}
          {showTeamManagement && (
            <div style={{ 
              background: 'white', 
              margin: '0 20px 20px 20px', 
              padding: '20px', 
              borderRadius: '15px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
            }}>
              <h2 style={{ color: '#286586', marginBottom: '20px' }}>Team Management</h2>
              {Object.keys(teamMembers).map(teamName => (
                <div key={teamName} style={{ marginBottom: '20px', padding: '15px', background: '#F5F5F5', borderRadius: '10px' }}>
                  <h3 style={{ color: '#FF6600', marginBottom: '10px' }}>{teamName}</h3>
                  {teamMembers[teamName].map((player, idx) => (
                    <div key={player.socketId} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '10px',
                      background: 'white',
                      marginBottom: '5px',
                      borderRadius: '5px'
                    }}>
                      <span>
                       {player.playerName || `Player ${idx + 1}`} {player.isCaptain ? '⭐ Captain' : '👁️ Viewer'}
                      </span>
                      <button
                        onClick={() => {
                          socket.emit('host:setCaptain', {
                            gameCode,
                            teamName,
                            socketId: player.socketId
                          });
                          
                          // Update local state immediately
                          setTeamMembers(prev => {
                            const updated = { ...prev };
                            updated[teamName] = updated[teamName].map(p => ({
                              ...p,
                              isCaptain: p.socketId === player.socketId
                            }));
                            return updated;
                          });
                        }}
                        disabled={player.isCaptain}
                        style={{
                          padding: '8px 16px',
                          background: player.isCaptain ? '#ccc' : '#FFD700',
                          color: player.isCaptain ? '#999' : '#000',
                          border: 'none',
                          borderRadius: '5px',
                          cursor: player.isCaptain ? 'not-allowed' : 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        {player.isCaptain ? 'Current Captain' : 'Make Captain'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">
  TEAM ANSWERS FOR {questions[selectedQuestionIndex]?.type === 'visual' 
    ? 'VISUAL ROUND' 
    : `QUESTION ${selectedQuestionIndex < 7 ? selectedQuestionIndex + 1 : selectedQuestionIndex}`}
</div>
              <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '10px', marginBottom: '10px' }}>
                <strong style={{ color: '#286586' }}>Question:</strong> {questions[selectedQuestionIndex]?.text}
              </div>
              <div style={{ background: '#FFF9E6', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
                <strong style={{ color: '#286586' }}>Correct answer:</strong> {questions[selectedQuestionIndex]?.answer}
                {questions[selectedQuestionIndex]?.type === 'visual' && questions[selectedQuestionIndex]?.imageUrl && (
                  <div style={{ marginTop: '15px', textAlign: 'center' }}>
                    <img 
                      src={questions[selectedQuestionIndex].imageUrl} 
                      alt="Visual Question"
                      style={{ maxWidth: '300px', height: 'auto', borderRadius: '10px', border: '2px solid #286586' }}
                    />
                  </div>
                )}
              </div>
              {getSortedTeams().map(team => {
                const isVisual = questions[selectedQuestionIndex]?.type === 'visual';
                const questionKey = isVisual ? 'visual' : (selectedQuestionIndex < 7 ? `q${selectedQuestionIndex + 1}` : `q${selectedQuestionIndex}`);
                const answer = team.answers?.[questionKey];
                
                return (
                  <div key={team.name} className="answer-item">
                    <div className="answer-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                        <div className="team-name-large">{team.name} | {team.score} pts</div>
                      </div>
                      {answer && !answer.marked && !isVisual && (
                        <div className="answer-buttons">
                          <button className="correct-button" onClick={() => markAnswer(team.name, true)}>✓</button>
                          <button className="incorrect-button" onClick={() => markAnswer(team.name, false)}>✗</button>
                        </div>
                      )}
                    </div>
                    {answer ? (
                      <div className="answer-details">
                        {isVisual ? (
                          <div>
                            {Array.isArray(answer.text) ? answer.text.map((ans, idx) => (
                              <div key={idx} style={{ marginBottom: '10px', padding: '10px', background: '#f5f5f5', borderRadius: '5px' }}>
                                <strong>#{idx + 1}:</strong> {ans}
                                {!answer.marked && (
                                  <span style={{ marginLeft: '10px' }}>
                                    {answer.correct && answer.correct[idx] !== null ? (
                                      <span style={{ fontWeight: '700', color: answer.correct[idx] ? '#00AA00' : '#C60404' }}>
                                        {answer.correct[idx] ? '✓ CORRECT' : '✗ INCORRECT'}
                                      </span>
                                    ) : (
                                      <>
                                        <button 
                                          style={{ marginLeft: '5px', padding: '2px 8px', background: '#00AA00', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                          onClick={() => markVisualAnswer(team.name, idx, true)}
                                        >✓</button>
                                        <button 
                                          style={{ marginLeft: '5px', padding: '2px 8px', background: '#C60404', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                                          onClick={() => markVisualAnswer(team.name, idx, false)}
                                        >✗</button>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                            )) : <div>Invalid answer format</div>}
                            {answer.marked && (
                              <div style={{ marginTop: '10px', fontWeight: '700', color: '#286586' }}>
                                Score: {answer.correct.filter(Boolean).length} / 6 points
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            Their answer: "{answer.text}"<br/>
                            Confidence: {answer.confidence} pts
                            {answer.marked && (
                              <div style={{ marginTop: '10px', fontWeight: '700', color: answer.correct ? '#00AA00' : '#C60404' }}>
                                {answer.correct ? '✓ CORRECT' : '✗ INCORRECT'}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: '#999', fontStyle: 'italic' }}>Waiting for answer...</div>
                    )}
                  </div>
                );
              })}
              {(() => {
                const { scored, total } = getScoringProgress();
const allScored = scored === total && total > 0;
const nextIndex = selectedQuestionIndex + 1;
const upcomingQuestion = questions[nextIndex];
const nextQuestionNum = upcomingQuestion?.type === 'visual' 
  ? 'VISUAL ROUND' 
  : nextIndex < 7 
    ? nextIndex + 1 
    : nextIndex;

return (
  <button 
                    className="continue-button"
                    onClick={nextQuestion}
                    disabled={!allScored}
                    style={{
                      opacity: allScored ? 1 : 0.5,
                      cursor: allScored ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {!allScored 
                      ? `Scored ${scored} of ${total} teams - Score remaining to continue` 
                      : typeof nextQuestionNum === 'string' 
 					  ? `ON TO ${nextQuestionNum}` 
                      : `ON TO QUESTION ${nextQuestionNum}`}
                  </button>
                );
              })()}
              
              <button 
                onClick={showStandings}
                className="submit-button"
                style={{ 
                  marginTop: '15px', 
                  background: '#32ADE6'
                }}
              >
                📊 SHOW STANDINGS TO TEAMS
              </button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'finalQuestionDisplay' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
                FINAL QUESTION...
                <br/><br/>
                The category is {finalQuestion.category}
                <br/><br/>
                {finalQuestion.question}
              </div>

              <button className="submit-button" onClick={pushFinalCategory}>
                PUSH CATEGORY (PLAYERS WAGER)
              </button>
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'waitingForWagers' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="question-display">
                <div className="question-number">WAITING FOR WAGERS...</div>
                Teams are submitting their wagers (0-30 points) based on the category: <strong>{finalQuestion.category}</strong>
              </div>

              <div style={{ marginTop: '30px' }}>
                {getSortedTeams().map(team => {
                  const wager = team.answers?.final?.confidence;
                  return (
                    <div key={team.name} style={{
                      background: wager !== undefined ? '#E8F5E9' : '#FFF9E6',
                      padding: '15px',
                      borderRadius: '10px',
                      marginBottom: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span style={{ fontSize: '18px', fontWeight: '700', color: '#286586' }}>
                        {team.name}
                      </span>
                      <span style={{ fontSize: '18px', fontWeight: '700', color: wager !== undefined ? '#00AA00' : '#999' }}>
                        {wager !== undefined ? `Wager: ${wager} pts` : 'Waiting...'}
                      </span>
                    </div>
                  );
                })}
              </div>
              
              {getSortedTeams().every(team => team.answers?.final?.confidence !== undefined) && (
                <button className="continue-button" onClick={revealFinalQuestion}>
                  REVEAL FINAL QUESTION
                </button>
              )}
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'finalScoring' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
              {timerActive && (
                <span style={{ marginLeft: '20px', color: timeRemaining <= 30 ? '#FF6600' : 'inherit' }}>
                  ⏱️ {formatTimer()}
                </span>
              )}
            </div>
          </div>
          <div className="main-content">
            <div className="left-panel">
              <div className="section-title">FINAL ANSWERS</div>
              <div style={{ background: '#E3F2FD', padding: '15px', borderRadius: '10px', marginBottom: '10px' }}>
                <strong style={{ color: '#286586' }}>Final Question:</strong> {finalQuestion.question}
              </div>
              <div style={{ background: '#FFF9E6', padding: '15px', borderRadius: '10px', marginBottom: '25px' }}>
                <strong style={{ color: '#286586' }}>Correct answer:</strong> {finalQuestion.answer}
              </div>

              {getSortedTeams().map(team => {
                const answer = team.answers?.final;
                return (
                  <div key={team.name} className="answer-item">
                    <div className="answer-header">
                      <div className="team-name-large">{team.name} | {team.score} pts</div>
                      {answer && answer.text && !answer.marked && (
  <div className="answer-buttons">
    <button className="correct-button" onClick={() => markAnswer(team.name, true)}>✓</button>
    <button className="incorrect-button" onClick={() => markAnswer(team.name, false)}>✗</button>
  </div>
)}
                    </div>
                        {answer && answer.text ? (
  <div className="answer-details">
    Their answer: "{answer.text}"<br/>
    Wager: {answer.confidence} pts
    {answer.marked && (
      <div style={{ marginTop: '10px', fontWeight: '700', color: answer.correct ? '#00AA00' : '#C60404' }}>
        {answer.correct ? `✓ CORRECT (+${answer.confidence} pts)` : `✗ INCORRECT (-${answer.confidence} pts)`}
      </div>
    )}
  </div>
) : answer ? (
  <div style={{ color: '#999', fontStyle: 'italic' }}>
    Wager submitted: {answer.confidence} pts. Waiting for answer...
  </div>
) : (
  <div style={{ color: '#999', fontStyle: 'italic' }}>Waiting for wager and answer...</div>
)}
                  </div>
                );
              })}

              {getSortedTeams().every(team => team.answers?.final?.marked) && (
                <button className="continue-button" onClick={endGame}>
                  END GAME & VIEW FINAL LEADERBOARD
                </button>
              )}
            </div>
            <div className="right-panel">
              <div className="teams-header">TEAMS</div>
              {getSortedTeams().map((team, idx) => (
                <div key={team.name} className="team-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div>
                      <span>{idx + 1}. {team.name}</span>
                      <span className="team-score" style={{ marginLeft: '10px' }}>{team.score}</span>
                    </div>
                    <button
                      onClick={() => viewTeamHistory(team.name)}
                      style={{
                        background: '#FF6600',
                        color: 'white',
                        border: 'none',
                        padding: '5px 10px',
                        borderRadius: '5px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {screen === 'endGame' && (
        <>
          <div className="header">
            <div className="logo">
              <img 
                src="https://quizzler.pro/img/quizzler_logo.png" 
                alt="Quizzler Logo" 
                className="logo-icon"
                style={{ height: '30px', width: 'auto' }}
              />
            </div>
            <div className="host-info">
              {hostName} | {venueName} | {gameCode}
            </div>
          </div>
          <div style={{ maxWidth: '1200px', margin: '60px auto', padding: '40px' }}>
            <div className="section-title" style={{ marginBottom: '40px' }}>FINAL LEADERBOARD</div>
            {getSortedTeams().map((team, idx) => (
              <div key={team.name} className="leaderboard-item" style={{
                background: idx === 0 
                  ? 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' 
                  : idx === 1 
                  ? 'linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%)' 
                  : idx === 2 
                  ? 'linear-gradient(135deg, #CD7F32 0%, #B87333 100%)'
                  : 'linear-gradient(135deg, #E0E0E0 0%, #BDBDBD 100%)'
              }}>
                <div className="leaderboard-rank">#{idx + 1}</div>
                <div className="leaderboard-name">{team.name}</div>
                <div className="leaderboard-score">{team.score} pts</div>
              </div>
            ))}
            <button className="submit-button" onClick={pushFinalRankings} style={{ marginTop: '30px' }}>
              PUSH FINAL RANKINGS TO TEAMS
            </button>
          </div>
        </>
      )}

      {selectedTeamHistory && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '40px',
            maxWidth: '800px',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 10px 50px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
              <h2 style={{ color: '#286586', fontSize: '28px', margin: 0 }}>
                {selectedTeamHistory.teamName} - Answer History
              </h2>
              <button 
                onClick={closeHistory}
                style={{
                  background: '#FF6B6B',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: '40px',
                  height: '40px',
                  fontSize: '24px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: '20px', padding: '15px', background: '#E3F2FD', borderRadius: '10px' }}>
              <div style={{ fontSize: '18px', color: '#286586' }}>
                <strong>Current Score:</strong> {game.teams[selectedTeamHistory.teamName]?.score} points
              </div>
            </div>

            {Object.entries(game.teams[selectedTeamHistory.teamName]?.answers || {}).map(([questionKey, answer]) => {
              // Handle different question key formats
              let questionNum, question;
              
              if (questionKey === 'final') {
                questionNum = 'Final';
                question = finalQuestion;
              } else if (questionKey === 'visual') {
                questionNum = 'Visual Round';
                question = questions[7]; // Visual round is at index 7
              } else {
                // Regular questions: q1-q7 and q8-q15
                const num = parseInt(questionKey.replace('q', ''));
                questionNum = num;
                // q1-q7 map to indices 0-6, q8-q15 map to indices 8-15
                question = num <= 7 ? questions[num - 1] : questions[num];
              }
              
              const isVisual = question?.type === 'visual' || Array.isArray(answer.text);
              
              return (
                <div key={questionKey} style={{
                  background: isVisual ? '#FFF9E6' : (answer.correct ? '#E8F5E9' : '#FFEBEE'),
                  border: `2px solid ${isVisual ? '#FFB300' : (answer.correct ? '#4CAF50' : '#F44336')}`,
                  borderRadius: '10px',
                  padding: '20px',
                  marginBottom: '15px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#286586', marginBottom: '5px' }}>
                        {isVisual && questionKey === 'visual' ? 'Visual Round' : `Question ${questionNum}${isVisual ? 'Visual Round' : ''}`}
                      </div>
                      <div style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>
                        {question?.text || question?.question || 'Question text not available'}
                      </div>
                    </div>
                    {!isVisual && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '14px', color: '#666' }}>Confidence</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF6600' }}>
                          {answer.confidence}
                        </div>
                      </div>
                    )}
                  </div>

                  {isVisual ? (
                    <div>
                      {Array.isArray(answer.text) && answer.text.map((ans, idx) => {
                        const isCorrect = Array.isArray(answer.correct) ? answer.correct[idx] : false;
                        return (
                          <div key={idx} style={{
                            background: isCorrect ? '#E8F5E9' : '#FFEBEE',
                            border: `2px solid ${isCorrect ? '#4CAF50' : '#F44336'}`,
                            borderRadius: '8px',
                            padding: '15px',
                            marginBottom: '10px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#286586', marginBottom: '5px' }}>
                                #{idx + 1}
                              </div>
                              <div style={{ fontSize: '16px' }}>{ans}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                              <div style={{
                                fontSize: '16px',
                                fontWeight: 'bold',
                                color: isCorrect ? '#2E7D32' : '#C62828'
                              }}>
                                {isCorrect ? '✓ CORRECT' : '✗ INCORRECT'}
                              </div>
                              <button
                                onClick={() => {
                                  const newCorrect = [...(answer.correct || [false, false, false, false, false, false])];
                                  newCorrect[idx] = !newCorrect[idx];
                                  
                                  const oldCorrectCount = (answer.correct || []).filter(Boolean).length;
                                  const newCorrectCount = newCorrect.filter(Boolean).length;
                                  const scoreDiff = newCorrectCount - oldCorrectCount;
                                  
                                  setGame(prev => ({
                                    ...prev,
                                    teams: {
                                      ...prev.teams,
                                      [selectedTeamHistory.teamName]: {
                                        ...prev.teams[selectedTeamHistory.teamName],
                                        score: prev.teams[selectedTeamHistory.teamName].score + scoreDiff,
                                        answers: {
                                          ...prev.teams[selectedTeamHistory.teamName].answers,
                                          [questionKey]: {
                                            ...answer,
                                            correct: newCorrect
                                          }
                                        }
                                      }
                                    }
                                  }));
                                  
                                  socket.emit('host:toggleCorrectness', { 
                                    gameCode, 
                                    teamName: selectedTeamHistory.teamName, 
                                    questionKey,
                                    visualIndex: idx
                                  });
                                }}
                                style={{
                                  background: isCorrect ? '#F44336' : '#4CAF50',
                                  color: 'white',
                                  border: 'none',
                                  padding: '8px 16px',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Mark as {isCorrect ? 'Incorrect' : 'Correct'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ marginTop: '15px', padding: '10px', background: '#E3F2FD', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', color: '#286586' }}>
                        Score: {Array.isArray(answer.correct) ? answer.correct.filter(Boolean).length : 0} / 6 points
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Their Answer:</div>
                        <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{answer.text}</div>
                      </div>

                      <div style={{ marginBottom: '15px' }}>
                        <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Correct Answer:</div>
                        <div style={{ fontSize: '16px', color: '#4CAF50', fontWeight: 'bold' }}>
                          {question?.answer || 'N/A'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{
                          fontSize: '16px',
                          fontWeight: 'bold',
                          color: answer.correct ? '#2E7D32' : '#C62828'
                        }}>
                          {answer.correct ? '✓ CORRECT' : '✗ INCORRECT'}
                          {answer.correct ? ` (+${answer.confidence} pts)` : ' (+0 pts)'}
                        </div>
                        <button
                          onClick={() => toggleCorrectness(selectedTeamHistory.teamName, questionKey)}
                          style={{
                            background: answer.correct ? '#F44336' : '#4CAF50',
                            color: 'white',
                            border: 'none',
                            padding: '10px 20px',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          Mark as {answer.correct ? 'Incorrect' : 'Correct'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}