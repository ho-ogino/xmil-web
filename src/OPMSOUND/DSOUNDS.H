
// optical
		#define	USE_DSOUND7



#include	"dsounds3.h"
#include	"dsounds7.h"

#define	PCMCHANNELS		2
#define	PCMBITS			16
#define	PCMMUL			(PCMCHANNELS * PCMBITS / 8)

#define	OPM_NOMAKE		((DWORD)-1)

#if T_TUNE
#define WAVEMAX   6
#define WAV_SEEK  0
#define WAV_SEEK1 1
#define WAV_STOP  2
#define WAV_PLAY  3
#define WAV_EJECT 4
#define WAV_FFREW 5
#else
#define WAVEMAX			3
#endif

extern	BYTE	pcmbuffer[];
extern	WORD	pcmbufsize[];
extern	WORD	ds_rate;
extern	DWORD	pcmfreemax;
extern	DWORD	eventbuffer;
extern	DWORD	ds_halfbuffer;
extern	DWORD	framesoundcnt;

extern	BYTE	usedsound3;

void dsounds_init(void);
void dsounds_makepara(void);



#define C4_DWORD(a,b,c,d) (((DWORD)d<<24) | ((DWORD)c << 16) | ((WORD)b << 8) | (a))

typedef struct {
	DWORD	head;
	DWORD	size;
} WAVE_HEADER;

typedef struct {
	WORD	format;
    WORD	channel;
    DWORD	rate;
    DWORD	rps;
	WORD	block;
	WORD	bit;
} WAVE_INFOS;


// ---------------------------------------------------------------------------


int InitDirectSound(void);
void TermDirectSound(void);

void DSound_Play(void);
void DSound_Stop(void);
void DSound_MasterON(void);
void DSound_MasterOFF(void);
void DSound_ResetBuffer(void);
void DSound_ResetSample(void);

#ifndef USE_DSOUND7

#define	PLAY_DIRECTSOUND	dx3_PlayDirectSound
#define	STOP_DIRECTSOUND	dx3_StopDirectSound

#define	STREAM_CREATE		dx3_InitSoundBuffer
#define	STREAM_TERM			dx3_TermSoundBuffer
#define	STREAM_MAKES		dx3_MakeSoundBuffer
#define	STREAM_CALLBACK		dx3_ProcSoundBuffer
#define	STREM_BUFFERCLEAR	dx3_ClearSoundBuffer
#define	STREM_BUFFERRESET	dx3_ResetSoundBuffer

#define	WAVE_INIT			dx3_WaveInit
#define	WAVE_TERM			dx3_WaveAllTerm
#define	WAVE_CREATE			dx3_WaveCreate
#define	WAVE_PLAY			dx3_WavePlay
#define	WAVE_STOP			dx3_WaveStop
#define	WAVE_VOLUME			dx3_WaveVolume
#define	WAVE_RELEASE		dx3_WaveRelease

#else

typedef struct {
	void	(* play)(void);
	void	(* stop)(void);

	int		(* streamcreate)(void);
	void	(* streamterm)(void);
	void	(* streammakes)(DWORD sample);
	void	(* streamcallback)(void);
	void	(* stramclear)(void);
	void	(* stramreset)(void);

	void	(* waveinit)(void);
	void	(* waveterm)(void);
	int		(* wavecreate)(LPSTR filename, int num, int volume);
	int		(* waveplay)(int num, int lpflg);
	void	(* wavestop)(int num);
	void	(* wavevolume)(int num, int volume);
	void	(* waverelease)(int num);
} DSOUNDS;

extern	DSOUNDS		dsounds;

#define	PLAY_DIRECTSOUND	dsounds.play
#define	STOP_DIRECTSOUND	dsounds.stop

#define	STREAM_CREATE		dsounds.streamcreate
#define	STREAM_TERM			dsounds.streamterm
#define	STREAM_MAKES		dsounds.streammakes
#define	STREAM_CALLBACK		dsounds.streamcallback
#define	STREM_BUFFERCLEAR	dsounds.stramclear
#define	STREM_BUFFERRESET	dsounds.stramreset

#define	WAVE_INIT			dsounds.waveinit
#define	WAVE_TERM			dsounds.waveterm
#define	WAVE_CREATE			dsounds.wavecreate
#define	WAVE_PLAY			dsounds.waveplay
#define	WAVE_STOP			dsounds.wavestop
#define	WAVE_VOLUME			dsounds.wavevolume
#define	WAVE_RELEASE		dsounds.waverelease

#endif
